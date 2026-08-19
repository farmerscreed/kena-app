-- 0053 — pause the Tier-C narration crons that have no consumer.
--
-- Audit D12 P1-10. `compute-weekly-summary` and `compute-monthly-baseline`
-- have run hourly since 0015, each invoking Sonnet and writing rows to
-- `ai_narration_cache`. Nothing reads that table:
--
--   $ grep -r ai_narration_cache apps/mobile/
--   (only a comment)
--
-- compute-monthly-baseline/index.ts:4-5 says so itself — "NOT pushed
-- (Q-D14-2 — push fatigue concern)". So both jobs bill tokens hourly and
-- produce output no surface renders.
--
-- We unschedule rather than drop: the edge functions, the table and the
-- invoke_* wrappers all stay in place, so re-enabling is a one-line
-- `cron.schedule` once a consuming surface ships (the Trends letter hero
-- and the Monthly Review are the intended homes).
--
-- Reversal:
--   select cron.schedule('compute-weekly-summary-hourly', '0 * * * *',
--     $$ select public.invoke_compute_weekly_summary_cron(); $$);
--   select cron.schedule('compute-monthly-baseline-hourly', '0 * * * *',
--     $$ select public.invoke_compute_monthly_baseline_cron(); $$);

do $$
begin
  perform cron.unschedule('compute-weekly-summary-hourly')
  where exists (select 1 from cron.job where jobname = 'compute-weekly-summary-hourly');
  perform cron.unschedule('compute-monthly-baseline-hourly')
  where exists (select 1 from cron.job where jobname = 'compute-monthly-baseline-hourly');
exception when undefined_function then null;
end$$;
