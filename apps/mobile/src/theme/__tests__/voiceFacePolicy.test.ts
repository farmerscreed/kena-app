// D13 PR-5 (§5.2 rule 2): Instrument Serif is retained for exactly one
// role — the narration voice slot and the Trends letter. It renders
// prose in Leiko's voice, never a measured value. This test walks the
// tree for fontFamilies.editorial / .voice usage and fails on any file
// outside the allowlist, so a new value surface can't quietly adopt
// the serif again (the audit found 14 value-bearing callsites had).

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const SRC = join(__dirname, '..', '..');

/** Files allowed to render the voice serif — prose surfaces only. */
const VOICE_SURFACES = new Set([
  // The narration voice slot ("What Leiko sees") and its hosts.
  'components/DailyPulseHero.tsx',
  'components/VitalInsightCard.tsx',
  'components/AIResponseRenderer.tsx',
  'components/AskLeikoBody.tsx',
  // The Person Overview's "What Leiko sees" voice slot (D13 §7.2a).
  'screens/Person/PersonOverviewScreen.tsx',
  // The Trends letter.
  'components/TrendsLetterHero.tsx',
  'components/TrendsCitedSection.tsx',
  'components/TrendsEvidenceCard.tsx',
  'screens/Trends/TrendsHeader.tsx',
  // Editorial prose (headlines/sentences — never values).
  'components/PersonCard.tsx',
  'components/PersonOrb.tsx',
  'components/Portrait.tsx',
  'components/ConstellationLegend.tsx',
  'components/DaySpine.tsx',
  'components/ClinicalContextFields.tsx',
  'components/DoctorCoverPreview.tsx',
  'components/DoctorNoteField.tsx',
  'components/ArticleRenderer.tsx',
  'screens/Home/ParentDashboard.tsx',
  'screens/Home/SelfBuyerHome.tsx',
  'screens/Home/CaregiverHome.tsx',
  'screens/ForYourDoctor/ForYourDoctorScreen.tsx',
  'screens/VitalDetail/ActivityDetail.tsx',
  // The token definition itself.
  'theme/tokens/typography.ts',
]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === '__mocks__' || entry === '__fixtures__') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !entry.endsWith('.d.ts')) {
      yield full;
    }
  }
}

it('the voice serif appears only on voice surfaces', () => {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const rel = relative(SRC, file);
    const source = readFileSync(file, 'utf8');
    if (/fontFamilies\.(editorial|voice)\b/.test(source) && !VOICE_SURFACES.has(rel)) {
      offenders.push(rel);
    }
  }
  expect(offenders).toEqual([]);
});

it('the allowlist itself never renders a value in the serif via valueFamily', () => {
  for (const rel of VOICE_SURFACES) {
    if (!/\.tsx$/.test(rel)) continue;
    const source = readFileSync(join(SRC, rel), 'utf8');
    expect({ file: rel, valueInSerif: /valueFamily=\{theme\.fontFamilies\.(editorial|voice)\}/.test(source) }).toEqual({
      file: rel,
      valueInSerif: false,
    });
  }
});
