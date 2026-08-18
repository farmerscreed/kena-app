// fontScalingPolicy — Sprint 19 (audit D12 P0-6).
//
// A source-scanning guard, not a unit test. The app accumulated 191
// `allowFontScaling={false}` props over eighteen sprints, one reasonable
// local decision at a time, until Dynamic Type was globally dead for a
// 55–80 user base. No single commit looked wrong. This test makes the
// aggregate visible.
//
// The rule: text may opt out of scaling ONLY where it is trapped inside
// fixed geometry (SVG rings, orbs, chart canvases, the fixed-ratio
// doctor-paper preview). Everywhere else must use
// `maxFontSizeMultiplier` so the user's setting is honoured up to a cap.

import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..', '..');

/**
 * Files permitted to keep `allowFontScaling={false}`. Every entry is
 * geometry-bound: its text sits inside a container whose size is fixed
 * in pt and cannot reflow. Adding to this list should require the same
 * scrutiny as adding a lint suppression — and the base font sizes in
 * these files must clear the 11pt floor instead.
 */
const GEOMETRY_LOCKED = new Set([
  'components/ActivityRingsHero.tsx',
  'components/ActivityWeeklyBars.tsx',
  'components/BPTwinLineChart.tsx',
  'components/ConstellationField.tsx',
  'components/CorrelationStrip.tsx',
  'components/DoctorCoverPreview.tsx',
  'components/MultiVitalChart.tsx',
  'components/PersonOrb.tsx',
  'components/SleepHypnogram.tsx',
  'components/SleepNightlyBars.tsx',
  'components/SleepStagesBar.tsx',
  'components/VitalTrendChart.tsx',
]);

/**
 * Strip comments before scanning. A file that *documents* the banned
 * prop — as several now do, explaining why they are exempt — must not
 * trip the check. Naive but sufficient: we only need to avoid matching
 * a literal prop spelling inside prose.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '') // /* */ and {/* */} interiors
    .replace(/^\s*\/\/.*$/gm, ''); // // line comments
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === '__snapshots__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

describe('font scaling policy', () => {
  const files = walk(SRC);

  it('finds the source tree (guards against a silently empty scan)', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('only allows opting out of font scaling in geometry-locked files', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = file.slice(SRC.length + 1).split('\\').join('/');
      const source = stripComments(readFileSync(file, 'utf8'));
      if (!source.includes('allowFontScaling={false}')) continue;
      if (!GEOMETRY_LOCKED.has(rel)) offenders.push(rel);
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the geometry-locked list from growing unnoticed', () => {
    // Not a cap for its own sake: every file here is a screen a
    // large-text user cannot benefit from, so the number is a debt
    // figure. Lower it when a component learns to reflow.
    expect(GEOMETRY_LOCKED.size).toBeLessThanOrEqual(12);
  });
});
