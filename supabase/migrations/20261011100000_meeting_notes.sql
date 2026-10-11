create table public.meetings (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms integer,
  status text not null default 'queued',
  audio_path text,
  audio_mime text,
  language text,
  speech_job_id text,
  error text,
  source text not null,
  diarization_note text,
  notes_status text not null default 'empty',
  notes_error text,
  constraint meetings_title_check check (char_length(title) between 1 and 120),
  constraint meetings_status_check check (status in ('queued', 'transcribing', 'ready', 'failed')),
  constraint meetings_source_check check (source in ('upload', 'recording')),
  constraint meetings_notes_status_check check (notes_status in ('empty', 'generating', 'ready', 'failed')),
  constraint meetings_duration_ms_check check (duration_ms is null or duration_ms >= 0)
);

create index meetings_user_id_created_at_idx on public.meetings (user_id, created_at desc);

create table public.speakers (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  display_name text not null,
  original_label text,
  constraint speakers_display_name_check check (char_length(display_name) between 1 and 80)
);

create index speakers_user_id_idx on public.speakers (user_id);
create index speakers_meeting_id_idx on public.speakers (meeting_id);

create table public.segments (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  speaker_id uuid references public.speakers (id) on delete set null,
  start_ms integer not null,
  end_ms integer not null,
  text text not null,
  language text,
  avg_logprob double precision,
  no_speech_prob double precision,
  search_vector tsvector generated always as (to_tsvector('simple', text)) stored,
  constraint segments_time_check check (start_ms >= 0 and end_ms >= start_ms)
);

create index segments_user_id_idx on public.segments (user_id);
create index segments_meeting_id_start_idx on public.segments (meeting_id, start_ms);
create index segments_speaker_id_idx on public.segments (speaker_id);
create index segments_search_vector_idx on public.segments using gin (search_vector);

create table public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null unique references public.meetings (id) on delete cascade,
  content jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint notes_version_check check (version >= 1)
);

create index notes_user_id_idx on public.notes (user_id);

create table public.chat_messages (
  id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  meeting_id uuid not null references public.meetings (id) on delete cascade,
  role text not null,
  text text not null,
  cited_segment_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint chat_messages_role_check check (role in ('user', 'assistant'))
);

create index chat_messages_user_id_idx on public.chat_messages (user_id);
create index chat_messages_meeting_id_created_at_idx on public.chat_messages (meeting_id, created_at);

alter table public.meetings enable row level security;
alter table public.speakers enable row level security;
alter table public.segments enable row level security;
alter table public.notes enable row level security;
alter table public.chat_messages enable row level security;

create policy meetings_owner on public.meetings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy speakers_owner on public.speakers
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy segments_owner on public.segments
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy notes_owner on public.notes
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy chat_messages_owner on public.chat_messages
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.meetings from public, anon;
revoke all on table public.speakers from public, anon;
revoke all on table public.segments from public, anon;
revoke all on table public.notes from public, anon;
revoke all on table public.chat_messages from public, anon;

grant select, insert, update, delete on table public.meetings to authenticated;
grant select, insert, update, delete on table public.speakers to authenticated;
grant select, insert, update, delete on table public.segments to authenticated;
grant select, insert, update, delete on table public.notes to authenticated;
grant select, insert, update, delete on table public.chat_messages to authenticated;

create or replace function public.replace_meeting_transcript(
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

  delete from public.segments
  where meeting_id = p_meeting_id and user_id = owner;

  delete from public.speakers
  where meeting_id = p_meeting_id and user_id = owner;

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
    duration_ms = p_duration_ms,
    language = p_language,
    diarization_note = p_diarization_note,
    error = null
  where id = p_meeting_id and user_id = owner;
end;
$$;

revoke all on function public.replace_meeting_transcript(uuid, text, integer, text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.replace_meeting_transcript(uuid, text, integer, text, jsonb, jsonb) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('meeting-audio', 'meeting-audio', false, 209715200);

create policy meeting_audio_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy meeting_audio_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy meeting_audio_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

create policy meeting_audio_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'meeting-audio'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
