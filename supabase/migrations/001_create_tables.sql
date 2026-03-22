-- LinguaLens Database Schema
-- Run against Supabase Postgres
-- Auth0 JWT "sub" claim used as user_id

create table if not exists public.vocab_entries (
  id text primary key,
  user_id text not null,
  word text not null,
  lemma text not null default '',
  language text not null default '',
  source_lang text not null default '',
  native_lang text not null default '',
  part_of_speech text not null default '',
  gender text not null default '',
  definition text not null default '',
  translations jsonb not null default '[]'::jsonb,
  usage_note text not null default '',
  example_sentence text not null default '',
  context_sentence text not null default '',
  clicked_sentence text not null default '',
  translation_text text not null default '',
  video_url text not null default '',
  video_title text not null default '',
  timestamp double precision not null default 0,
  saved_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  starred boolean not null default false
);

create index if not exists vocab_entries_user_id_idx
  on public.vocab_entries (user_id);

create index if not exists vocab_entries_user_saved_at_idx
  on public.vocab_entries (user_id, saved_at desc);

create table if not exists public.quiz_results (
  id text primary key,
  user_id text not null,
  question text not null default '',
  quoted_term text not null default '',
  options jsonb not null default '[]'::jsonb,
  correct_index integer not null default 0,
  selected_index integer not null default 0,
  correct boolean not null default false,
  explanation text not null default '',
  target_word text not null default '',
  difficulty text not null default '',
  context_lines jsonb not null default '[]'::jsonb,
  video_url text not null default '',
  video_title text not null default '',
  subtitle_timestamp double precision not null default 0,
  answered_at timestamptz not null default timezone('utc', now())
);

create index if not exists quiz_results_user_id_idx
  on public.quiz_results (user_id);

create index if not exists quiz_results_user_answered_at_idx
  on public.quiz_results (user_id, answered_at desc);

create table if not exists public.user_settings (
  user_id text primary key,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.vocab_entries enable row level security;
alter table public.quiz_results enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "vocab_entries_select_own" on public.vocab_entries;
create policy "vocab_entries_select_own"
  on public.vocab_entries
  for select
  using ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "vocab_entries_insert_own" on public.vocab_entries;
create policy "vocab_entries_insert_own"
  on public.vocab_entries
  for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "vocab_entries_update_own" on public.vocab_entries;
create policy "vocab_entries_update_own"
  on public.vocab_entries
  for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "vocab_entries_delete_own" on public.vocab_entries;
create policy "vocab_entries_delete_own"
  on public.vocab_entries
  for delete
  using ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "quiz_results_select_own" on public.quiz_results;
create policy "quiz_results_select_own"
  on public.quiz_results
  for select
  using ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "quiz_results_insert_own" on public.quiz_results;
create policy "quiz_results_insert_own"
  on public.quiz_results
  for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "quiz_results_update_own" on public.quiz_results;
create policy "quiz_results_update_own"
  on public.quiz_results
  for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "quiz_results_delete_own" on public.quiz_results;
create policy "quiz_results_delete_own"
  on public.quiz_results
  for delete
  using ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings
  for select
  using ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings
  for insert
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings
  for update
  using ((auth.jwt() ->> 'sub') = user_id)
  with check ((auth.jwt() ->> 'sub') = user_id);

drop policy if exists "user_settings_delete_own" on public.user_settings;
create policy "user_settings_delete_own"
  on public.user_settings
  for delete
  using ((auth.jwt() ->> 'sub') = user_id);
