#!/usr/bin/env bash
# Deploy the five D13 edge functions to leiko-prod.
# Token: LEIKO_PAT env var, or the session file ~/secrets/leiko-pat.
set -euo pipefail
cd "$(dirname "$0")/.."

REF="${LEIKO_REF:-kqnzxjrpnjnczhgdwdqg}"
TOKEN="${LEIKO_PAT:-}"
if [ -z "$TOKEN" ] && [ -f "$HOME/secrets/leiko-pat" ]; then
  TOKEN="$(cat "$HOME/secrets/leiko-pat")"
fi
[ -n "$TOKEN" ] || { echo "no token: export LEIKO_PAT or create ~/secrets/leiko-pat" >&2; exit 1; }
export SUPABASE_ACCESS_TOKEN="$TOKEN"

FNS=(detect-anomaly sync compute-correlations compute-weekly-summary compute-monthly-baseline)
if [ $# -gt 0 ]; then FNS=("$@"); fi
for fn in "${FNS[@]}"; do
  echo "── deploying $fn ──"
  npx supabase functions deploy "$fn" --project-ref "$REF" --use-api
done
echo "── all functions deployed ──"
