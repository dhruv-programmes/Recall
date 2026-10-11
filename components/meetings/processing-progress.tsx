import { progressDetail, progressLabel, progressPercent } from "@/lib/format";
import type { MeetingProgress } from "@/lib/types";

export function ProcessingProgress({
  progress,
  compact = false,
}: {
  progress: MeetingProgress;
  compact?: boolean;
}) {
  const percent = progressPercent(progress);
  const label = progressLabel(progress);
  const detail = compact ? null : progressDetail(progress);
  const valueLabel = percent == null ? label : `${label}, ${percent}%`;

  return (
    <div className={compact ? "mt-2 grid gap-1" : "grid max-w-xl gap-2"}>
      {compact ? null : (
        <div className="flex items-baseline justify-between gap-3 text-sm">
          <p aria-live="polite">{label}</p>
          <p className="tabular-nums text-muted-foreground">
            {percent == null ? "In progress" : `${percent}%`}
          </p>
        </div>
      )}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        aria-valuetext={valueLabel}
        aria-label={label}
      >
        <div
          className={
            percent == null
              ? "progress-indeterminate h-full rounded-full bg-primary"
              : "h-full rounded-full bg-primary"
          }
          style={percent == null ? undefined : { width: `${percent}%` }}
        />
      </div>
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      {compact || percent != null ? null : (
        <p className="text-sm leading-6 text-muted-foreground">
          {progress.phase === "notes"
            ? "Notes are being written."
            : "This page checks again every few seconds."}
        </p>
      )}
    </div>
  );
}
