-- 0055 — reading context tags + note.
--
-- D13 §4.5 (PR-1 slice only — the founder approved landing the enum and
-- readings columns now so the nightly cron can compute
-- context-conditioned BP baselines the moment tagged readings exist;
-- the tag sheet UI and the rest of §4.5 arrive in PR-11, so
-- context_tags stays '{}' until then).
--
-- No RLS changes: the columns inherit the readings policies, and the
-- sync edge function inserts with an explicit column list, so the
-- defaults apply untouched.

create type public.reading_context as enum
  ('morning','evening','before_meds','after_meds','after_walking','feeling_unwell','resting','unspecified');

alter table public.readings
  add column context_tags public.reading_context[] not null default '{}',
  add column context_note text check (length(context_note) <= 280);
