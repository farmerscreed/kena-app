// Story chapters — the page's spine. A chapter is a real event in the
// person's data with a before/since band comparison:
//
//   · a detected level shift (utils/changePoints — statistical);
//   · a medication joining the log (§4.5 — the person's own record);
//   · after-walking tags becoming regular (the lifestyle anchor).
//
// A shift and an anchor within ±2 weeks merge into ONE chapter, so the
// story reads "around 14 June: walking became regular, and the band
// moved from 136–148 down to 128–139" — two observations side by
// side, never a causal claim.

import type { RiverAnchor } from './bandRiver';
import type { ChangePoint } from '../../utils/changePoints';
import { storyCopy } from '../voice/storyCopy';

export interface ChapterAnchorEvent {
  kind: 'medication' | 'movement';
  /** ISO date the event became true. */
  date: string;
  /** Medication label; never sent to any AI payload. */
  label?: string;
}

export interface StoryChapter {
  id: string;
  weekStart: string;
  /** Band before/since, rounded for display; null when the shift has
   *  no adjacent anchor rows (short history edge). */
  before: { low: number; high: number } | null;
  since: { low: number; high: number } | null;
  direction: 'down' | 'up' | 'none';
  /** The §-copy sentence for the shift (or steady). */
  sentence: string;
  /** Alongside-observations (anchored events within ±2 weeks). */
  alongside: string[];
}

const TWO_WEEKS_MS = 14 * 86_400_000;

function weekLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

function bandAround(
  anchors: RiverAnchor[],
  index: number,
  side: 'before' | 'after',
): { low: number; high: number } | null {
  const slice = side === 'before' ? anchors.slice(Math.max(0, index - 4), index) : anchors.slice(index, index + 4);
  if (slice.length === 0) return null;
  const low = Math.round(slice.reduce((s, a) => s + a.p10, 0) / slice.length);
  const high = Math.round(slice.reduce((s, a) => s + a.p90, 0) / slice.length);
  return { low, high };
}

export function buildStoryChapters(
  anchors: RiverAnchor[],
  changePoints: ChangePoint[],
  events: ChapterAnchorEvent[],
): StoryChapter[] {
  const chapters: StoryChapter[] = changePoints.map((cp) => {
    const before = bandAround(anchors, cp.index, 'before');
    const since = bandAround(anchors, cp.index, 'after');
    const direction = cp.delta < 0 ? ('down' as const) : ('up' as const);
    const label = weekLabel(cp.weekStart);
    const sentence =
      before && since
        ? direction === 'down'
          ? storyCopy.chapters.shiftDown(label, before.low, before.high, since.low, since.high)
          : storyCopy.chapters.shiftUp(label, before.low, before.high, since.low, since.high)
        : '';
    const nearby = events.filter(
      (e) =>
        Math.abs(Date.parse(e.date) - Date.parse(cp.weekStart)) <= TWO_WEEKS_MS,
    );
    return {
      id: `shift-${cp.weekStart}`,
      weekStart: cp.weekStart,
      before,
      since,
      direction,
      sentence,
      alongside: nearby.map((e) =>
        e.kind === 'medication'
          ? storyCopy.chapters.medicationAnchor(e.label ?? 'A medication', weekLabel(e.date))
          : storyCopy.chapters.movementAnchor(weekLabel(e.date)),
      ),
    };
  });

  // Events with no adjacent shift still earn a chapter — the honest
  // "this started, the band has not moved (yet)" observation.
  const claimed = new Set(chapters.flatMap((c) => c.alongside));
  for (const e of events) {
    const sentence =
      e.kind === 'medication'
        ? storyCopy.chapters.medicationAnchor(e.label ?? 'A medication', weekLabel(e.date))
        : storyCopy.chapters.movementAnchor(weekLabel(e.date));
    if (claimed.has(sentence)) continue;
    chapters.push({
      id: `${e.kind}-${e.date}`,
      weekStart: e.date,
      before: null,
      since: null,
      direction: 'none',
      sentence,
      alongside: [],
    });
  }

  chapters.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  return chapters;
}

/** §6.5-derived: the week after-walking tags first hit ≥3/week for two
 *  consecutive weeks. Null when never regular. */
export function movementRegularityOnset(
  readings: Array<{ measuredAtSec: number; contextTags: string[] }>,
): string | null {
  const byWeek = new Map<string, number>();
  for (const r of readings) {
    if (!r.contextTags.includes('after_walking')) continue;
    const d = new Date(r.measuredAtSec * 1000);
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    const key = d.toISOString().slice(0, 10);
    byWeek.set(key, (byWeek.get(key) ?? 0) + 1);
  }
  const weeks = [...byWeek.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (let i = 0; i < weeks.length - 1; i++) {
    const [w1, n1] = weeks[i];
    const [w2, n2] = weeks[i + 1];
    const consecutive =
      Date.parse(w2) - Date.parse(w1) === 7 * 86_400_000;
    if (n1 >= 3 && n2 >= 3 && consecutive) return w1;
  }
  return null;
}
