#!/usr/bin/env bash
# release-d13.sh — the D13 release runbook as one command.
#
# Run from the repo root with the PAT exported per session
# (docs/release/prod-db-access.md — from 1Password, never in a file):
#
#   export LEIKO_PAT='sbp_…'
#   bash tools/release-d13.sh
#
# What it does, in order:
#   1. Shows the migration-history drift (the db-migrate workflow's
#      pre-existing "remote versions not found locally" failure).
#   2. Repairs the remote-only versions as reverted, then pushes
#      migrations 0053–0058.
#   3. Deploys the five edge functions the release depends on.
#   4. Invokes the detect-anomaly cron once so vital_baselines
#      populates tonight's truth layer immediately.
set -euo pipefail

REF='kqnzxjrpnjnczhgdwdqg'
: "${LEIKO_PAT:?export LEIKO_PAT first (see docs/release/prod-db-access.md)}"
export SUPABASE_ACCESS_TOKEN="$LEIKO_PAT"

echo "── 1. migration history ─────────────────────────────────────"
npx supabase migration list --project-ref "$REF" || true
echo
echo "Remote-only versions (no matching file in supabase/migrations/)"
echo "need repairing before push. Review the list above; for each"
echo "remote-only version run:"
echo "  npx supabase migration repair --status reverted <version> --project-ref $REF"
read -r -p "Repair done / not needed — push migrations now? [y/N] " go
[ "$go" = "y" ] || exit 1

echo "── 2. push migrations ───────────────────────────────────────"
npx supabase db push --project-ref "$REF"

echo "── 3. deploy edge functions ─────────────────────────────────"
for fn in detect-anomaly sync compute-correlations compute-weekly-summary compute-monthly-baseline; do
  echo "deploying $fn…"
  npx supabase functions deploy "$fn" --project-ref "$REF" --use-api
done

echo "── 4. populate the truth layer now ──────────────────────────"
python3 tools/prod-sql.py "select public.invoke_detect_anomaly_cron();"

echo "── done ─────────────────────────────────────────────────────"
echo "vital_baselines populates within a minute or two; the first"
echo "Story letter arrives after the next weekly cron (Mon 04:00 UTC)."
