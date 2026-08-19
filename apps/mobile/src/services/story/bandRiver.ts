// bandRiver — the Story Trends hero's data (D13 story page).
//
// The river is the person's own 28-day usual band, recomputed at weekly
// anchors across the story window, drawn as a flowing ribbon. Same
// maths as the truth layer (nearest-rank percentile, population σ) so
// the ribbon the story shows IS the band the verdicts use — computed
// client-side from the server's full reading history, which means the
// river backfills instantly instead of waiting months for snapshots.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../types/database';
import { detectChangePoints, type WeeklyAnchor, type ChangePoint } from '../../utils/changePoints';

export interface RiverReading {
  measuredAtSec: number;
  systolic: number;
  diastolic: number;
  contextTags: string[];
}

export interface RiverAnchor extends WeeklyAnchor {
  p10: number;
  p90: number;
  diaMean: number;
  diaP10: number;
  diaP90: number;
}

export interface BandRiverData {
  anchors: RiverAnchor[];
  changePoints: ChangePoint[];
  readings: RiverReading[];
}

const WINDOW_DAYS = 28;
const DAY_SEC = 86_400;
export const STORY_MONTHS = 6;
const MIN_ANCHOR_SAMPLES = 6;

function percentile(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * pct));
  return sorted[idx];
}

function mondayOf(sec: number): Date {
  const d = new Date(sec * 1000);
  d.setUTCHours(0, 0, 0, 0);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - ((day + 6) % 7));
  return d;
}

/** Pure: weekly rolling-band anchors over the readings. Exported for
 *  tests — parity with the truth layer's maths is what makes the river
 *  honest. */
export function buildRiverAnchors(
  readings: RiverReading[],
  nowSec: number,
): RiverAnchor[] {
  if (readings.length === 0) return [];
  const sorted = [...readings].sort((a, b) => a.measuredAtSec - b.measuredAtSec);
  const start = mondayOf(Math.max(sorted[0].measuredAtSec, nowSec - STORY_MONTHS * 30 * DAY_SEC));
  const anchors: RiverAnchor[] = [];
  for (
    let anchor = start.getTime() / 1000 + 7 * DAY_SEC;
    anchor <= nowSec + DAY_SEC;
    anchor += 7 * DAY_SEC
  ) {
    const windowStart = anchor - WINDOW_DAYS * DAY_SEC;
    const inWindow = sorted.filter(
      (r) => r.measuredAtSec >= windowStart && r.measuredAtSec < anchor,
    );
    if (inWindow.length < MIN_ANCHOR_SAMPLES) continue;
    const sys = inWindow.map((r) => r.systolic).sort((a, b) => a - b);
    const dia = inWindow.map((r) => r.diastolic).sort((a, b) => a - b);
    const mu = sys.reduce((s, x) => s + x, 0) / sys.length;
    const diaMu = dia.reduce((s, x) => s + x, 0) / dia.length;
    anchors.push({
      weekStart: new Date(anchor * 1000).toISOString().slice(0, 10),
      mean: mu,
      sampleCount: inWindow.length,
      p10: percentile(sys, 0.1),
      p90: percentile(sys, 0.9),
      diaMean: diaMu,
      diaP10: percentile(dia, 0.1),
      diaP90: percentile(dia, 0.9),
    });
  }
  return anchors;
}

/** Fetch the story window's readings and derive the river + shifts. */
export async function fetchBandRiver(
  client: SupabaseClient<Database>,
  familyId: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<BandRiverData> {
  const since = new Date((nowSec - STORY_MONTHS * 30 * DAY_SEC) * 1000).toISOString();
  // context_tags lands with migration 0055; a prod instance that
  // predates the main merge would fail the whole select over one
  // optional column — retry without it so the river always flows.
  let res = await client
    .from('readings')
    .select('measured_at, systolic, diastolic, context_tags')
    .eq('family_id', familyId)
    .eq('hidden', false)
    .gte('measured_at', since)
    .order('measured_at', { ascending: true })
    .limit(2000);
  if (res.error) {
    res = (await client
      .from('readings')
      .select('measured_at, systolic, diastolic')
      .eq('family_id', familyId)
      .eq('hidden', false)
      .gte('measured_at', since)
      .order('measured_at', { ascending: true })
      .limit(2000)) as typeof res;
  }
  const readings: RiverReading[] = ((res.data ?? []) as unknown as Array<{
    measured_at: string;
    systolic: number;
    diastolic: number;
    context_tags: string[] | null;
  }>).map((r) => ({
    measuredAtSec: Math.floor(Date.parse(r.measured_at) / 1000),
    systolic: r.systolic,
    diastolic: r.diastolic,
    contextTags: r.context_tags ?? [],
  }));
  const anchors = buildRiverAnchors(readings, nowSec);
  return { anchors, changePoints: detectChangePoints(anchors), readings };
}
