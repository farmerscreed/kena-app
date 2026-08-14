# ADR-0007: Unified "Connect" invite — one code, backend infers direction

> **2026-08-14 — completed and amended by ADR-0012** (Connect one-door
> simplification). The two-symmetric-rows UX this ADR called for is now
> shipped; resolved decision #2 (keep the email-match gate) is REVERSED
> (replaced by single-use + expiry + server-side rate limiting); the
> open question on the legacy-function back-compat window is closed —
> the four legacy functions are deleted from the hosted project; and
> pending connects now resolve via a database trigger at watch pairing.
> Read `docs/_adr/0012-connect-one-door.md` and
> `docs/04-screens/connect-invite.md` for current state.

- **Status**: Accepted (founder sign-off 2026-06-02; built + device-verified)
- **Date**: 2026-06-02
- **Amends / supersedes**: ADR-0006 §3 (the two-direction invite design)
- **Touches**: invite edge functions, `invitations` table semantics,
  the invite/accept UI, Settings family section

## Context

ADR-0006 §3 specified **two invite directions** (wearer-initiated and
caregiver-initiated pending) under one consent principle. We built it:
four edge functions (`send-family-invite`, `accept-family-invite`,
`send-care-invite`, `resolve-care-invite`), three UI entry points
(Home "+ Add someone", Settings "Invite someone to follow", Settings
"Care for another person"), and two invitation `kind`s.

**In production testing this proved confusing — to the point that the
founder, who co-designed it, got crossed about which button to use and
where to enter a generated code.** The root flaw: the user must *declare
the direction* by choosing the correct button (am I inviting someone to
follow me, or am I following someone?). Direction is an implementation
detail the user should never have to reason about.

Concretely, the friction observed:
- Three "invite-ish" buttons that all deal with codes differently.
- A code generated on the caregiver's phone with "nowhere to enter it"
  (because that direction expects the *other* party to enter it).
- The `kind` split (`caregiver` vs `parent_pairing`) leaking into UX.

## Decision

Collapse the entire invite surface into **one symmetric concept:
"Connect with someone."** The user never picks a direction; the backend
infers who-watches-whom from **who actually wears a watch** (i.e. who
owns a self-circle with device data).

### The model

- **One action to share:** "Connect with someone" → generates **one code**
  (+ link) tied to the sharer. Available to any user, anywhere it's
  surfaced (home + settings can both point at it).
- **One action to accept:** "Enter a code" → the other person types it.
- **Direction is resolved server-side at accept time**, from watch
  ownership:

  | Sharer wears a watch? | Accepter wears a watch? | Result |
  | --- | --- | --- |
  | Yes | No  | Accepter **follows** sharer (watches them) |
  | No  | Yes | Sharer **follows** accepter (watches them) |
  | Yes | Yes | Accepter follows sharer; sharer is then **offered** the chance to follow back (not auto-mutual) |
  | No  | No  | Hold: neither has data yet. Connection is *pending* and resolves to one of the above as soon as one of them pairs a watch. |

  "Wears a watch" = the user owns a self-circle (`families.parent_user_id
  = user` with an active device, i.e. `isSelfCircle` + a paired device).

- **Following = a `caregiver` `family_members` row** on the wearer's
  circle (the existing visibility model is unchanged: the wearer controls
  what each follower sees).

### What this replaces

- **Edge functions:** the four invite functions collapse to **two** —
  `connect-create` (generate a code tied to the caller) and
  `connect-accept` (resolve direction + wire memberships). The old four
  are retired (kept briefly for back-compat with already-issued codes,
  then removed).
- **`invitations.kind`:** the `caregiver` / `parent_pairing` distinction
  is no longer surfaced or required for direction; a single connect kind
  suffices. (Column retained; semantics simplified.)
- **UI:** three entry points → **one "Connect" sheet** (share a code) and
  **one "Enter a code" sheet** (accept). Home "+ Add someone" opens the
  connect sheet; Settings shows both "Connect with someone" and "Enter a
  code" as the only two family invite rows.

### Pending-connection resolution

The "neither has a watch yet" case reuses the pending-invite plumbing
from ADR-0006 (nullable `family_id`, resolve-after-pairing). The
difference: resolution is **symmetric** — whoever pairs first becomes the
wearer, the other becomes their follower; if both eventually pair, it
becomes mutual.

## Rationale

1. **Matches the mental model.** Users think "connect me with my
   daughter," not "I am the wearer-initiator." One verb, no direction
   choice.
2. **Eliminates the whole confusion class.** No "I made a code but can't
   enter it anywhere" — sharing and entering are clearly the two halves
   of one act.
3. **Fewer moving parts.** 4 edge functions → 2; 3 UI buttons → 2; the
   `kind` branch disappears from UX.
4. **Safe by construction.** Direction derives from real data ownership,
   so a code can never wire the wrong person as the wearer (the bug class
   ADR-0006 worked hard to kill stays dead — the wearer is always whoever
   owns the watch, never asserted by an invite).
5. **The wearer still controls visibility.** Following grants a caregiver
   membership; the per-vital visibility controls are unchanged.

## Consequences

- **New edge functions** `connect-create` + `connect-accept`; retire the
  four old ones after a back-compat window. Requires deploy.
- **Migration**: likely none beyond what 0029 already did (nullable
  `family_id` covers the pending case). A connect may add a lightweight
  marker on `invitations` to denote "symmetric connect" vs legacy rows.
- **UI rebuild**: CareInviteSheet + AcceptInviteSheet + the Settings rows
  consolidate. Home "+ Add someone" → the connect sheet.
- **Copy**: plain, direction-free — "Connect with someone", "Enter a
  code", with the analogies retained ("so you can keep an eye on each
  other / on them"). Voice-checked.
- **ADR-0006 §3 is superseded** for the invite UX; its consent principle
  (wearer controls visibility) and pending-invite plumbing are retained.
- **Already-issued codes**: the back-compat window lets codes generated by
  the old functions still resolve until those functions are removed.

## Resolved decisions (founder, 2026-06-02)

1. **Both wear watches → ASK, not auto-mutual.** The accepter follows the
   sharer; the sharer is then offered "follow them back too?" rather than
   it happening silently. Avoids presuming someone wants to broadcast
   their own readings.
2. **Keep the email-match gate.** Accepting requires the email the sharer
   entered — a cheap guard against mistyped/forwarded codes.

## Open question (resolve while building)

- **Back-compat window length** for the old four edge functions before
  removal (any code already issued during testing should still resolve).

## Alternatives considered

- **Keep two directions, just relabel the buttons** (the "fix + clarify"
  option). Rejected by the founder: relabeling reduces but doesn't remove
  the direction-choice burden; the confusion is structural.
- **Auto-detect direction in the client** instead of the backend.
  Rejected: the client doesn't reliably know the *other* party's watch
  status; the server does. Direction belongs where the data is.
