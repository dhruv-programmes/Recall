alter table public.meetings add column notes_progress jsonb;

create or replace function public.append_meeting_transcript(
  p_meeting_id uuid,
  p_language text,
  p_duration_ms integer,
  p_diarization_note text,
  p_speakers jsonb,
  p_segments jsonb
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  owner uuid := (select auth.uid());
begin
  if owner is null then
    raise exception 'Not signed in';
  end if;

  if not exists (
    select 1
    from public.meetings
    where id = p_meeting_id and user_id = owner
  ) then
    raise exception 'Meeting not found';
  end if;

  insert into public.speakers (id, user_id, meeting_id, display_name, original_label)
  select
    (item->>'id')::uuid,
    owner,
    p_meeting_id,
    item->>'display_name',
    item->>'original_label'
  from jsonb_array_elements(coalesce(p_speakers, '[]'::jsonb)) as speakers(item);

  insert into public.segments (
    id, user_id, meeting_id, speaker_id, start_ms, end_ms, text,
    avg_logprob, no_speech_prob
  )
  select
    (item->>'id')::uuid,
    owner,
    p_meeting_id,
    nullif(item->>'speaker_id', '')::uuid,
    (item->>'start_ms')::integer,
    (item->>'end_ms')::integer,
    coalesce(item->>'text', ''),
    nullif(item->>'avg_logprob', '')::double precision,
    nullif(item->>'no_speech_prob', '')::double precision
  from jsonb_array_elements(coalesce(p_segments, '[]'::jsonb)) as segments(item);

  update public.meetings
  set
    status = 'ready',
    ended_at = now(),
    duration_ms = greatest(coalesce(duration_ms, 0), coalesce(p_duration_ms, 0)),
    language = coalesce(p_language, language),
    diarization_note = coalesce(p_diarization_note, diarization_note)
  where id = p_meeting_id and user_id = owner;
end;
$$;

revoke all on function public.append_meeting_transcript(uuid, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.append_meeting_transcript(uuid, text, integer, text, jsonb, jsonb) to authenticated;
