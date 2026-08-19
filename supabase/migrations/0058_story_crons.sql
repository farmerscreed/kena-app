-- 0058 — re-enable the Tier-C narration crons, wired to a consumer.
--
-- 0053 paused compute-weekly-summary and compute-monthly-baseline
-- because they ran HOURLY, called Sonnet, and wrote ai_narration_cache
-- rows that nothing read. The Story Trends page (founder-commissioned
-- 2026-08-19) is the consuming surface: its letter renders the latest
-- weekly_summary / monthly_baseline rows.
--
-- Cadence is scoped to what the surface needs — the letter changes
-- weekly/monthly, so the crons run weekly/monthly, not hourly:
--   weekly summary   → Mondays 04:00 UTC
--   monthly baseline → 1st of the month, 04:15 UTC
-- (Each invocation regenerates via upsert, so cadence = spend.)

do $$
begin
  perform cron.unschedule('compute-weekly-summary-weekly')
  where exists (select 1 from cron.job where jobname = 'compute-weekly-summary-weekly');
  perform cron.unschedule('compute-monthly-baseline-monthly')
  where exists (select 1 from cron.job where jobname = 'compute-monthly-baseline-monthly');
exception when undefined_function then null;
end$$;

select cron.schedule(
  'compute-weekly-summary-weekly',
  '0 4 * * 1',
  $$ select public.invoke_compute_weekly_summary_cron(); $$
);

select cron.schedule(
  'compute-monthly-baseline-monthly',
  '15 4 1 * *',
  $$ select public.invoke_compute_monthly_baseline_cron(); $$
);
