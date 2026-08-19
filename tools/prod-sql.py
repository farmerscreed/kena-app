#!/usr/bin/env python3
"""Run SQL against the Leiko production DB via the Supabase Management API.

The MCP Supabase tools and the `supabase` CLI are logged into a different
account and cannot reach leiko-prod (ref kqnzxjrpnjnczhgdwdqg). This wraps the
Management API `database/query` endpoint, which can.

Usage:
    export LEIKO_PAT='sbp_…'          # Personal Access Token, from 1Password
    echo "select count(*) from push_tokens" | python3 tools/prod-sql.py

    python3 tools/prod-sql.py <<'SQL'
    select u.email, pt.last_seen_at
    from push_tokens pt join auth.users u on u.id = pt.user_id;
    SQL

The PAT is read from the LEIKO_PAT env var only — never hard-code it here.
See docs/release/prod-db-access.md for the full runbook.
"""
import os
import sys
import json
import urllib.request
import urllib.error

PAT = os.environ.get("LEIKO_PAT")
if not PAT:
    # Session fallback: a 0600 file the founder drops for a release run and
    # deletes right after. The env var still wins when set.
    _pat_file = os.path.expanduser("~/secrets/leiko-pat")
    if os.path.isfile(_pat_file):
        with open(_pat_file) as fh:
            PAT = fh.read().strip()
if not PAT:
    sys.exit("LEIKO_PAT is not set. `export LEIKO_PAT='sbp_…'` (from 1Password) first.")
REF = os.environ.get("LEIKO_REF", "kqnzxjrpnjnczhgdwdqg")

sql = sys.stdin.read().strip()
if not sql:
    sys.exit("No SQL on stdin.")

req = urllib.request.Request(
    f"https://api.supabase.com/v1/projects/{REF}/database/query",
    data=json.dumps({"query": sql}).encode(),
    headers={
        "Authorization": f"Bearer {PAT}",
        "Content-Type": "application/json",
        "User-Agent": "leiko-claude/1.0",  # required: the API rejects a missing UA
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req) as resp:
        print(json.dumps(json.load(resp), indent=2, default=str))
except urllib.error.HTTPError as exc:
    sys.exit(f"HTTP {exc.code}: {exc.read().decode()}")
