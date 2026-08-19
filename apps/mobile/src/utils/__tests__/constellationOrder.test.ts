import {
  statusUrgencyFor,
  orderConstellationNodes,
  focalNode,
  statusUrgency,
  type ConstellationNode,
} from '../constellationOrder';
import type { Status } from '../../components/StatusPill';

// Minimal node fixture — only the fields ordering reads.
function node(
  id: string,
  status: Status,
  isSelf = false,
): ConstellationNode {
  return {
    id,
    isSelf,
    status,
    fullName: id,
    initial: id[0]?.toUpperCase() ?? '·',
    accentIndex: 1,
    lastReadingAgeMs: 60_000,
  bpLabel: '—',
    headline: '',
    sentence: '',
    relation: '',
    vitalStrip: { bp: '—', hr: '—', spo2: '—', sleep: '—' },
  };
}

describe('statusUrgency', () => {
  it('ranks urgent > attention > watch > calm states', () => {
    expect(statusUrgency('urgent')).toBeGreaterThan(statusUrgency('attention'));
    expect(statusUrgency('attention')).toBeGreaterThan(statusUrgency('watch'));
    expect(statusUrgency('watch')).toBeGreaterThan(statusUrgency('clear'));
  });

  it('ranks offline at the silence tier (D13 §7.1a) while sleeping stays calm', () => {
    // Silence is the most actionable calm-adjacent state: a stale or
    // absent reading outranks a normal number, though never an active
    // concern.
    expect(statusUrgency('offline')).toBe(3);
    expect(statusUrgency('sleeping')).toBe(0);
    expect(statusUrgency('urgent')).toBeGreaterThan(statusUrgency('offline'));
    expect(statusUrgency('attention')).toBeGreaterThan(statusUrgency('offline'));
    expect(statusUrgency('offline')).toBeGreaterThan(statusUrgency('learning'));
  });
});

describe('orderConstellationNodes', () => {
  it('puts the self node first when everyone is calm', () => {
    const ordered = orderConstellationNodes([
      node('mum', 'clear'),
      node('you', 'clear', true),
      node('dad', 'clear'),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(['you', 'mum', 'dad']);
  });

  it('floats an at-risk person above the self node', () => {
    const ordered = orderConstellationNodes([
      node('you', 'clear', true),
      node('mum', 'attention'),
      node('dad', 'clear'),
    ]);
    expect(ordered[0].id).toBe('mum'); // attention pre-empts You
    expect(ordered.map((n) => n.id)).toEqual(['mum', 'you', 'dad']);
  });

  it('ranks confirmed-urgent above calm-concerned above You', () => {
    const ordered = orderConstellationNodes([
      node('you', 'clear', true),
      node('mum', 'attention'),
      node('dad', 'urgent'),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(['dad', 'mum', 'you']);
  });

  it('preserves incoming order among equally-calm non-self nodes', () => {
    const ordered = orderConstellationNodes([
      node('you', 'clear', true),
      node('mum', 'clear'),
      node('dad', 'clear'),
      node('aunt', 'clear'),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(['you', 'mum', 'dad', 'aunt']);
  });

  it('a calm self node never displaces an urgent person even if listed first', () => {
    const ordered = orderConstellationNodes([
      node('you', 'clear', true),
      node('dad', 'urgent'),
    ]);
    expect(ordered[0].id).toBe('dad');
  });

  it('handles a pure self constellation (no one added)', () => {
    const ordered = orderConstellationNodes([node('you', 'clear', true)]);
    expect(ordered.map((n) => n.id)).toEqual(['you']);
  });

  it('handles a pure caregiver constellation (no self node)', () => {
    const ordered = orderConstellationNodes([
      node('mum', 'clear'),
      node('dad', 'urgent'),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(['dad', 'mum']);
  });
});

describe('focalNode', () => {
  it('returns the most urgent node', () => {
    expect(
      focalNode([node('you', 'clear', true), node('dad', 'urgent')])?.id,
    ).toBe('dad');
  });

  it('returns the self node in a calm constellation', () => {
    expect(
      focalNode([node('mum', 'clear'), node('you', 'clear', true)])?.id,
    ).toBe('you');
  });

  it('returns null for an empty constellation', () => {
    expect(focalNode([])).toBeNull();
  });
});


describe('statusUrgencyFor — the §7.1a silence rank', () => {
  it('raises any calm status to the silence tier after 48h without a reading', () => {
    expect(statusUrgencyFor('clear', 49 * 3600_000)).toBe(3);
    expect(statusUrgencyFor('learning', null)).toBe(3);
  });
  it('a fresh reading keeps the base rank', () => {
    expect(statusUrgencyFor('clear', 3600_000)).toBe(0);
    expect(statusUrgencyFor('learning', 3600_000)).toBe(1);
  });
  it('an active concern always outranks silence', () => {
    expect(statusUrgencyFor('attention', 49 * 3600_000)).toBeGreaterThan(
      statusUrgencyFor('clear', 49 * 3600_000),
    );
    expect(statusUrgencyFor('urgent', null)).toBe(5);
  });
});
