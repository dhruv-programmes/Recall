"""Local speech service. Bind to 127.0.0.1 only. Do not expose this process publicly."""

from __future__ import annotations

import json
import os
import threading
import uuid
from pathlib import Path


def load_env_file() -> None:
    candidates = [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]
    for candidate in candidates:
        if not candidate.is_file():
            continue
        for line in candidate.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"'))
        return


load_env_file()
# pyannote phones home when this is left on. Diarization itself stays local.
os.environ["PYANNOTE_METRICS_ENABLED"] = "false"

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Meeting notes speech")
_lock = threading.Lock()
_model = None
_model_error: str | None = None
_pipeline = None
_pipeline_error: str | None = None
_jobs: dict[str, dict] = {}


def data_root() -> Path:
    return Path(os.environ.get("DATA_DIR", Path.cwd() / "data")).resolve()


def jobs_dir() -> Path:
    path = data_root() / "speech-jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def save_job(job: dict) -> None:
    target = jobs_dir() / f"{job['id']}.json"
    target.write_text(json.dumps(job), encoding="utf-8")


def load_jobs() -> None:
    folder = jobs_dir()
    for file in folder.glob("*.json"):
        try:
            job = json.loads(file.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if job.get("status") in {"queued", "running"}:
            job["status"] = "failed"
            job["error"] = "The speech service restarted before this job finished. Retry transcription."
            save_job(job)
        _jobs[job["id"]] = job


def assert_audio_path(audio_path: str) -> Path:
    root = data_root()
    resolved = Path(audio_path).resolve()
    if resolved != root and root not in resolved.parents:
        raise HTTPException(status_code=400, detail="Audio path is outside the data directory")
    if not resolved.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return resolved


def get_model():
    global _model, _model_error
    if _model is not None:
        return _model
    if _model_error:
        raise RuntimeError(_model_error)
    from faster_whisper import WhisperModel

    name = os.environ.get("WHISPER_MODEL", "small")
    device = os.environ.get("WHISPER_DEVICE", "cpu")
    compute = os.environ.get("WHISPER_COMPUTE", "int8" if device == "cpu" else "float16")
    try:
        _model = WhisperModel(name, device=device, compute_type=compute)
    except Exception as exc:  # noqa: BLE001 - surface the setup error to the UI
        _model_error = f"Could not load faster-whisper model '{name}': {exc}"
        raise RuntimeError(_model_error) from exc
    return _model


def diarization_status() -> tuple[bool, str]:
    token = os.environ.get("HF_TOKEN", "").strip()
    if not token:
        return False, "Speaker labels stay unknown until HF_TOKEN is set."
    try:
        import pyannote.audio  # noqa: F401
    except Exception as exc:  # noqa: BLE001
        return False, f"pyannote.audio is not installed ({exc.__class__.__name__})."
    return True, "Speaker diarization runs locally."


def get_pipeline():
    global _pipeline, _pipeline_error
    if _pipeline is not None:
        return _pipeline
    if _pipeline_error:
        raise RuntimeError(_pipeline_error)
    ready, detail = diarization_status()
    if not ready:
        raise RuntimeError(detail)
    from pyannote.audio import Pipeline

    token = os.environ["HF_TOKEN"].strip()
    try:
        pipeline = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
    except TypeError:
        pipeline = Pipeline.from_pretrained(
            "pyannote/speaker-diarization-3.1", use_auth_token=token
        )
    if pipeline is None:
        _pipeline_error = "Could not load the local speaker model."
        raise RuntimeError(_pipeline_error)
    import torch

    device = torch.device("cuda" if os.environ.get("WHISPER_DEVICE") == "cuda" and torch.cuda.is_available() else "cpu")
    pipeline.to(device)
    _pipeline = pipeline
    return pipeline


def load_waveform(path: Path, sample_rate: int = 16000) -> dict:
    import av
    import numpy as np
    import torch

    container = av.open(str(path))
    resampler = av.audio.resampler.AudioResampler(format="flt", layout="mono", rate=sample_rate)
    pieces: list = []
    try:
        for frame in container.decode(audio=0):
            resampled = resampler.resample(frame)
            frames = resampled if isinstance(resampled, list) else [resampled]
            for item in frames:
                if item is not None:
                    pieces.append(item.to_ndarray().reshape(-1))
        resampled = resampler.resample(None)
        frames = resampled if isinstance(resampled, list) else [resampled]
        for item in frames:
            if item is not None:
                pieces.append(item.to_ndarray().reshape(-1))
    finally:
        container.close()
    if not pieces:
        raise RuntimeError("The audio file has no samples to classify.")
    samples = np.concatenate(pieces).astype(np.float32, copy=False)
    return {
        "waveform": torch.from_numpy(np.ascontiguousarray(samples)).unsqueeze(0),
        "sample_rate": sample_rate,
        "uri": path.stem,
    }


def turns_from_output(output) -> list[tuple[float, float, str]]:
    annotation = getattr(output, "exclusive_speaker_diarization", None)
    if annotation is None:
        annotation = getattr(output, "speaker_diarization", output)
    turns: list[tuple[float, float, str]] = []
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        turns.append((float(turn.start), float(turn.end), str(speaker)))
    turns.sort()
    return turns


def pipeline_is_blocked(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(piece in text for piece in ("403", "gated", "restricted", "authorized", "cannot access"))


def speaker_note(turns: list[tuple[float, float, str]]) -> str:
    count = len({label for _, _, label in turns})
    if count == 1:
        return "One speaker was found on this computer. You can rename them in the transcript."
    return f"{count} speakers were separated on this computer. Names are placeholders until you edit them."


def diarize(path: Path) -> tuple[list[tuple[float, float, str]] | None, str]:
    ready, detail = diarization_status()
    if not ready:
        return None, detail
    try:
        pipeline = get_pipeline()
        output = pipeline(load_waveform(path))
        turns = turns_from_output(output)
    except Exception as exc:  # noqa: BLE001
        if pipeline_is_blocked(exc):
            return (
                None,
                "Speaker classification is installed, but this Hugging Face account has not accepted the pyannote model terms. Open the speaker-diarization-community-1 model page, accept the conditions, then choose Separate speakers again.",
            )
        return None, f"Speaker classification failed and was skipped: {exc}"
    if not turns:
        return None, "Speaker classification found no one speaking. Lines stay Unknown."
    return turns, speaker_note(turns)


def speaker_for(start: float, end: float, turns: list[tuple[float, float, str]] | None) -> str | None:
    if not turns or end <= start:
        return None
    best_label = None
    best_overlap = 0.0
    for turn_start, turn_end, label in turns:
        overlap = min(end, turn_end) - max(start, turn_start)
        if overlap > best_overlap:
            best_overlap = overlap
            best_label = label
    if best_label is not None:
        return best_label
    midpoint = (start + end) / 2
    nearest = None
    nearest_gap = 0.75
    for turn_start, turn_end, label in turns:
        gap = 0.0 if turn_start <= midpoint <= turn_end else min(abs(midpoint - turn_start), abs(midpoint - turn_end))
        if gap < nearest_gap:
            nearest_gap = gap
            nearest = label
    return nearest


def transcribe(path: Path, on_progress) -> dict:
    on_progress("loading", 0.0, None, None)
    model = get_model()

    def collect(vad_filter: bool):
        segments_iter, info = model.transcribe(
            str(path),
            vad_filter=vad_filter,
            word_timestamps=True,
        )
        duration = getattr(info, "duration", None)
        duration = float(duration) if duration is not None else None
        on_progress("transcribing", 0.0, 0.0, duration)
        gathered = []
        for segment in segments_iter:
            gathered.append(segment)
            processed = float(segment.end)
            ratio = processed / duration if duration else None
            on_progress("transcribing", ratio, processed, duration)
        return gathered, info, duration

    try:
        segments, info, duration = collect(True)
    except Exception:
        segments, info, duration = collect(False)
    on_progress("diarizing", 1.0, duration, duration)
    turns, note = diarize(path)
    payload = align_speakers(segments, turns)
    language = getattr(info, "language", None)
    return {
        "language": language,
        "duration": duration,
        "diarization_note": note,
        "segments": payload,
        "phase": "completed",
        "progress": 1.0,
        "processed_seconds": duration,
    }


def align_speakers(segments, turns: list[tuple[float, float, str]] | None) -> list[dict]:
    payload: list[dict] = []

    def add(start: float, end: float, text: str, segment, label: str | None) -> None:
        cleaned = " ".join(text.split())
        if not cleaned:
            return
        payload.append(
            {
                "start": start,
                "end": end,
                "text": cleaned,
                "avg_logprob": float(segment.avg_logprob) if segment.avg_logprob is not None else None,
                "no_speech_prob": float(segment.no_speech_prob) if segment.no_speech_prob is not None else None,
                "speaker_label": label,
            }
        )

    for segment in segments:
        words = [word for word in (getattr(segment, "words", None) or []) if (word.word or "").strip()]
        if not words:
            add(
                float(segment.start),
                float(segment.end),
                segment.text or "",
                segment,
                speaker_for(float(segment.start), float(segment.end), turns),
            )
            continue
        group_label = None
        group_words = []
        for word in words:
            label = speaker_for(float(word.start), float(word.end), turns)
            if group_words and label != group_label:
                add(
                    float(group_words[0].start),
                    float(group_words[-1].end),
                    "".join(item.word for item in group_words),
                    segment,
                    group_label,
                )
                group_words = []
            group_label = label
            group_words.append(word)
        if group_words:
            add(
                float(group_words[0].start),
                float(group_words[-1].end),
                "".join(item.word for item in group_words),
                segment,
                group_label,
            )
    return payload


def report_progress(job_id: str, phase: str, progress, processed, duration) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if not job or job.get("status") not in {"queued", "running"}:
            return
        job["phase"] = phase
        job["progress"] = None if progress is None else max(0.0, min(1.0, float(progress)))
        job["processed_seconds"] = processed
        if duration is not None:
            job["duration"] = duration
        save_job(job)


def run_job(job_id: str, audio_path: str) -> None:
    with _lock:
        job = _jobs[job_id]
        job["status"] = "running"
        job["phase"] = "loading"
        job["progress"] = 0.0
        save_job(job)
    try:
        result = transcribe(
            Path(audio_path),
            lambda phase, progress, processed, duration: report_progress(
                job_id, phase, progress, processed, duration
            ),
        )
        with _lock:
            job = _jobs[job_id]
            job["status"] = "completed"
            job.update(result)
            job["error"] = None
            save_job(job)
    except Exception as exc:  # noqa: BLE001
        with _lock:
            job = _jobs[job_id]
            job["status"] = "failed"
            job["error"] = str(exc)
            save_job(job)


class JobRequest(BaseModel):
    audio_path: str


@app.on_event("startup")
def startup() -> None:
    load_jobs()


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "whisper_model": os.environ.get("WHISPER_MODEL", "small"),
        "diarization_configured": diarization_status()[0],
    }


@app.post("/jobs")
def create_job(body: JobRequest) -> dict:
    path = assert_audio_path(body.audio_path)
    job_id = str(uuid.uuid4())
    job = {
        "id": job_id,
        "status": "queued",
        "audio_path": str(path),
        "language": None,
        "duration": None,
        "diarization_note": None,
        "segments": [],
        "error": None,
        "phase": "queued",
        "progress": 0.0,
        "processed_seconds": None,
    }
    with _lock:
        _jobs[job_id] = job
        save_job(job)
    threading.Thread(target=run_job, args=(job_id, str(path)), daemon=True).start()
    return {"id": job_id, "status": "queued"}


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    with _lock:
        job = _jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Speech job not found")
    return job
