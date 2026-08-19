// Story chapters — real events + detected shifts, observations only.
import { buildStoryChapters, movementRegularityOnset } from '../chapters';
import type { RiverAnchor } from '../bandRiver';
import { lintVoiceText } from '../../voice/voiceLint';
import { storyCopy } from '../../voice/storyCopy';

function anchor(weekStart: string, mean: number): RiverAnchor {
  return {
    weekStart,
    mean,
    sampleCount: 10,
    p10: mean - 7,
    p90: mean + 7,
    diaMean: 80,
    diaP10: 74,
    diaP90: 86,
  };
}

const WEEKS = [
  '2026-05-04', '2026-05-11', '2026-05-18', '2026-05-25',
  '2026-06-01', '2026-06-08', '2026-06-15', '2026-06-22',
  '2026-06-29', '2026-07-06',
];
const SHIFTED = WEEKS.map((w, i) => anchor(w, i < 5 ? 141 : 130));

describe('buildStoryChapters', () => {
  const cp = {
    index: 5,
    weekStart: '2026-06-08',
    beforeMean: 141,
    afterMean: 130,
    delta: -11,
    tStat: 9,
  };

  it('a downward shift renders the before/since sentence', () => {
    const [ch] = buildStoryChapters(SHIFTED, [cp], []);
    expect(ch.direction).toBe('down');
    expect(ch.sentence).toContain('moved from 134–148 down to 123–137');
  });

  it('an event within two weeks joins the shift chapter as an alongside line', () => {
    const [ch, ...rest] = buildStoryChapters(SHIFTED, [cp], [
      { kind: 'movement', date: '2026-06-01' },
    ]);
    expect(ch.alongside).toHaveLength(1);
    expect(ch.alongside[0]).toContain('after walking became regular');
    expect(rest).toHaveLength(0); // absorbed, not duplicated
  });

  it('an event far from any shift earns its own chapter with no band claim', () => {
    const chapters = buildStoryChapters(SHIFTED, [cp], [
      { kind: 'medication', date: '2026-05-04', label: 'Amlodipine' },
    ]);
    const medChapter = chapters.find((c) => c.id.startsWith('medication'));
    expect(medChapter).toBeTruthy();
    expect(medChapter!.before).toBeNull();
    expect(medChapter!.sentence).toContain('joined the log');
  });

  it('every sentence passes the voice lint and never claims causation', () => {
    const chapters = buildStoryChapters(SHIFTED, [cp], [
      { kind: 'medication', date: '2026-06-08', label: 'Amlodipine' },
      { kind: 'movement', date: '2026-06-01' },
    ]);
    for (const ch of chapters) {
      for (const text of [ch.sentence, ...ch.alongside]) {
        if (!text) continue;
        expect(lintVoiceText(text).hardHits).toEqual([]);
        expect(text).not.toMatch(/because|caused|thanks to|working|due to/i);
      }
    }
    expect(lintVoiceText(storyCopy.chapters.noChapters).hardHits).toEqual([]);
    expect(lintVoiceText(storyCopy.riverCaption).hardHits).toEqual([]);
  });
});

describe('movementRegularityOnset', () => {
  const sec = (iso: string) => Math.floor(Date.parse(`${iso}T09:00:00Z`) / 1000);
  const tagged = (iso: string) => ({ measuredAtSec: sec(iso), contextTags: ['after_walking'] });

  it('finds the first of two consecutive ≥3-tag weeks', () => {
    const readings = [
      tagged('2026-06-01'), tagged('2026-06-03'), tagged('2026-06-05'),
      tagged('2026-06-08'), tagged('2026-06-10'), tagged('2026-06-12'),
    ];
    expect(movementRegularityOnset(readings)).toBe('2026-06-01');
  });

  it('one busy week alone is not regularity', () => {
    const readings = [
      tagged('2026-06-01'), tagged('2026-06-03'), tagged('2026-06-05'),
      tagged('2026-06-15'),
    ];
    expect(movementRegularityOnset(readings)).toBeNull();
  });
});
