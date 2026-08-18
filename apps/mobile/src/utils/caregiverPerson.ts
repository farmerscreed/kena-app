// CaregiverPerson — Sprint 7.7a (caregiver Family Constellation).
//
// Pure derivation: takes a ParentSummary + the person's slot index in
// the family list (rotating accent palette) + a `now` timestamp, and
// returns the shape the bird's-eye view consumes (PersonOrb + legend).
//
// Status taxonomy maps to the existing classifier + staleness:
//   clear     ← classifyReading(latest BP) → 'in_pattern' AND fresh (≤12h)
//   attention ← classifyReading(latest BP) → 'calm_concerned'
//   urgent    ← classifyReading(latest BP) → 'confirmed_urgent'
//   offline   ← latest BP measured > 12h ago (D13 §6 stale threshold for BP)
//   watch     ← Sprint 15 deferral (3-day BP trend up). v1 treats as `clear`;
//               type space is preserved so 7.7b/15 can flip without code
//               surgery elsewhere.
//   sleeping  ← Sprint 8.5+ deferral (active sleep session within last 4h).
//               Cross-phone caregivers don't have the OWNING phone's sleep
//               state in v1; never returned by this helper. The type space
//               accepts 'sleeping' so test fixtures can simulate it.
//
// Headline is a deterministic placeholder until Sprint 12.5 wires AI
// narration. Calm, factual, voice-rule-clean. The legend renders this
// truncated to one line.
//
// Sprint 7.7b additions:
//   - `sentence` — a longer deterministic placeholder rendered in the
//     editorial PersonCard's prose paragraph. Same voice rules.
//   - `vitalStrip` — pre-formatted display strings for the four-vital
//     row (BP / HR / SpO2 / Sleep). '—' fallback when data is missing.
//     The data flows through fetchParentSummaries (latestHr / latestSpo2
//     / latestSleep) which queries vitals_other directly.

import type {
  HrSummary,
  ParentSummary,
  SleepSummary,
  Spo2Summary,
} from '../services/families/fetchParentSummaries';
import type { Status } from '../components/StatusPill';
import { classifyReading } from './classification';
import { resolveBpBaselines } from './vitalBaselines';

const BP_STALE_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12h per D13 §6
const MIN_PER_HR = 60;
const NO_VALUE = '—';

export type CaregiverAccentSlot = 1 | 2 | 3;

/** Pre-formatted display strings for the editorial PersonCard's
 *  four-vital row. Each entry is "—" when the underlying data is null
 *  (caregivers wait for the parent's owning phone to /sync the value
 *  through to vitals_other). */
export interface VitalStripLabels {
  bp: string;
  hr: string;
  spo2: string;
  sleep: string;
}

export interface CaregiverPerson {
  /** Family id — opaque identifier. */
  id: string;
  /** Full display name as the parent profile carries it. */
  fullName: string;
  /** First letter, uppercased; '·' if name is empty. */
  initial: string;
  /** Slot in the rotating per-person palette (1..3). Consumer maps to
   *  `theme.colors.person[slot]`. */
  accentIndex: CaregiverAccentSlot;
  status: Status;
  /** Pre-formatted BP, e.g. "122/78" or "—" when no reading exists. */
  bpLabel: string;
  /** One-line factual headline. Placeholder until Sprint 12.5 AI. */
  headline: string;
  /** Longer editorial prose. Placeholder until Sprint 12.5 AI. */
  sentence: string;
  /** Display string for the relationship column ("Mom" / "Dad" / "Aunt"). */
  relation: string;
  /** Pre-formatted four-vital labels for the editorial card row. */
  vitalStrip: VitalStripLabels;
  /** Parent age in years derived from parentYearOfBirth. `undefined`
   *  when the family record has no DOB on file — PersonCard then
   *  renders the eyebrow as just "MOM" without " · N". */
  age?: number;
}

export function caregiverPersonFromParent(
  parent: ParentSummary,
  indexInList: number,
  nowMs: number = Date.now(),
): CaregiverPerson {
  const accentIndex = (((indexInList % 3) + 1) as CaregiverAccentSlot);
  const trimmedName = parent.parentDisplayName.trim();
  const initial = trimmedName.length > 0 ? trimmedName[0].toUpperCase() : '·';

  let status: Status = 'clear';
  let bpLabel = NO_VALUE;
  let headline = 'No readings yet';
  let sentence = 'No readings yet. The watch will sync once it pairs.';

  const r = parent.latestReading;
  if (r) {
    const measuredAtMs = Date.parse(r.measuredAt);
    const ageMs = Math.max(0, nowMs - measuredAtMs);
    const ageLabel = humanizeAge(ageMs);
    bpLabel = `${r.systolic}/${r.diastolic}`;

    if (ageMs > BP_STALE_THRESHOLD_MS) {
      status = 'offline';
      headline = `Last reading ${ageLabel} ago`;
      sentence = `No reading in the last ${ageLabel}. The watch may be off the wrist.`;
    } else {
      // D13 PR-1 (P0-2) — judge the parent's reading against the
      // parent's OWN truth-layer baseline: the server row seeded by
      // whichever fetcher produced this summary, else a provisional
      // recompute over the recent-readings window the summary already
      // carries. Below the §4.3 sufficiency gate the classifier
      // renders the learning state. History (latest first) enables the
      // three-consecutive confirmation for the latest reading.
      const samples = parent.recentReadings.map((s) => ({
        measuredAtSec: Math.floor(Date.parse(s.measuredAt) / 1000),
        systolic: s.systolic,
        diastolic: s.diastolic,
      }));
      const baselines = resolveBpBaselines(
        parent.familyId,
        samples,
        Math.floor(nowMs / 1000),
      );
      const tier = classifyReading(
        { systolic: r.systolic, diastolic: r.diastolic, pulse: r.pulse },
        baselines,
        samples.slice().sort((a, b) => b.measuredAtSec - a.measuredAtSec),
      ).tier;
      switch (tier) {
        case 'confirmed_urgent':
          status = 'urgent';
          headline = 'A calm check-in helps right now.';
          sentence = `BP ${bpLabel} ${ageLabel} ago — above the usual range. A calm check-in helps.`;
          break;
        case 'calm_concerned':
          status = 'attention';
          headline = "Worth a chat — pattern's a little off.";
          sentence = `BP ${bpLabel} ${ageLabel} ago — a little above the usual band.`;
          break;
        case 'in_pattern':
          status = 'clear';
          headline = `Read ${ageLabel} ago — in the usual range.`;
          sentence = `BP ${bpLabel} ${ageLabel} ago. Inside the usual band.`;
          break;
      }
    }
  }

  const currentYear = new Date(nowMs).getFullYear();
  const age =
    typeof parent.parentYearOfBirth === 'number' &&
    parent.parentYearOfBirth > 0 &&
    parent.parentYearOfBirth <= currentYear
      ? currentYear - parent.parentYearOfBirth
      : undefined;

  return {
    id: parent.familyId,
    fullName: trimmedName.length > 0 ? trimmedName : 'Family member',
    initial,
    accentIndex,
    status,
    bpLabel,
    headline,
    sentence,
    // Sprint 19 Block 5 — prefer the per-caregiver label when the
    // viewer has set one; otherwise fall back to the family-default
    // (which itself falls back to "Wearer" when stored as 'self' via
    // Block 1's formatRelation).
    relation: resolveRelation(parent.caregiverRelationshipLabel, parent.parentRelationship),
    vitalStrip: formatVitalStrip(bpLabel, parent.latestHr, parent.latestSpo2, parent.latestSleep),
    age,
  };
}

/** Sprint 19 Block 5 — resolution order for the eyebrow relationship:
 *    1. per-caregiver label (family_members.caregiver_relationship_label)
 *    2. family default (families.parent_relationship via formatRelation)
 *  Returns the formatted display string. */
export function resolveRelation(
  caregiverLabel: string | null | undefined,
  familyDefault: string | null | undefined,
): string {
  const label = (caregiverLabel ?? '').trim();
  if (label.length > 0) return formatRelation(label);
  return formatRelation(familyDefault);
}

/** Sprint 19 — caregiver-side relationship label.
 *
 *  `families.parent_relationship === 'self'` is a self-buyer onboarding
 *  signal — "the wearer is themselves." From a caregiver's perspective
 *  (a co-caregiver invited into a self-buyer's family), seeing "Self"
 *  in the eyebrow makes no sense — the wearer is THEIR loved one, not
 *  themselves. We render "Wearer" as a neutral fallback. Sprint 19
 *  Block 5 adds a per-caregiver label that takes precedence over this
 *  fallback when the caregiver sets one.
 *
 *  Also unwraps the 'other:<label>' encoding — the prefix is a storage
 *  convention, not a display string. */
export function formatRelation(parentRelationship: string | null | undefined): string {
  const raw = (parentRelationship ?? '').trim();
  const lower = raw.toLowerCase();
  if (!raw) return 'Family';
  if (lower === 'self') return 'Wearer';
  if (lower === 'other') return 'Family';
  if (lower.startsWith('other:')) {
    const label = raw.slice('other:'.length).trim();
    return label.length > 0 ? label : 'Family';
  }
  return raw;
}

function formatVitalStrip(
  bpLabel: string,
  hr: HrSummary | null,
  spo2: Spo2Summary | null,
  sleep: SleepSummary | null,
): VitalStripLabels {
  return {
    bp: bpLabel,
    hr: hr ? String(hr.bpm) : NO_VALUE,
    spo2: spo2 ? `${spo2.percent}%` : NO_VALUE,
    sleep: sleep ? formatSleepDuration(sleep.totalMinutes) : NO_VALUE,
  };
}

function formatSleepDuration(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours}:${mins.toString().padStart(2, '0')}`;
}

export function caregiverPeopleFromParents(
  parents: ParentSummary[],
  nowMs: number = Date.now(),
): CaregiverPerson[] {
  return parents.map((p, i) => caregiverPersonFromParent(p, i, nowMs));
}

// Shared helper for human-readable age, used by the headline fallbacks.
function humanizeAge(ageMs: number): string {
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < MIN_PER_HR) return `${minutes} min`;
  const hours = Math.floor(minutes / MIN_PER_HR);
  if (hours < 24) return `${hours} hr`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'}`;
}
