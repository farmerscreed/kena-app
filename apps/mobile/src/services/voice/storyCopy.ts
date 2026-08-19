// Story Trends copy — one definition site. Every sentence is an
// OBSERVATION about the person's own band: what moved, since when,
// alongside what. Never why, never a promise, never a clinical
// category. New strings in this file were introduced with the story
// page (founder-commissioned, 2026-08-19) and are voice-linted in the
// suite; flag any change to the founder.

import type { Subject } from './tierVocabulary';

export const storyCopy = {
  pageTitle: 'Your story',
  riverEyebrow: 'Your usual band, over time',
  riverCaption:
    'The ribbon is the range your readings usually land in, recomputed each week. Watch where it goes — that movement is the story.',
  chapters: {
    eyebrow: 'Chapters',
    shiftDown: (weekLabel: string, beforeLow: number, beforeHigh: number, afterLow: number, afterHigh: number): string =>
      `Around ${weekLabel}, the usual band moved from ${beforeLow}–${beforeHigh} down to ${afterLow}–${afterHigh}.`,
    shiftUp: (weekLabel: string, beforeLow: number, beforeHigh: number, afterLow: number, afterHigh: number): string =>
      `Around ${weekLabel}, the usual band moved from ${beforeLow}–${beforeHigh} up to ${afterLow}–${afterHigh}.`,
    medicationAnchor: (label: string, weekLabel: string): string =>
      `${label} joined the log around ${weekLabel}.`,
    movementAnchor: (weekLabel: string): string =>
      `Readings tagged after walking became regular around ${weekLabel}.`,
    alongside: 'What was happening alongside:',
    noChapters:
      "No shifts so far — the usual band has held steady across this window. Steady is a finding too.",
  },
  drivers: {
    eyebrow: 'What moves together',
  },
  doctor: (possessive: string): string =>
    possessive === 'your'
      ? 'Bring this to your doctor'
      : `Bring this to ${possessive} doctor`,
  letterEyebrow: 'What Leiko sees',
} as const;

export function subjectAwareDoctorLine(subject: Subject): string {
  return storyCopy.doctor(subject.possessive);
}
