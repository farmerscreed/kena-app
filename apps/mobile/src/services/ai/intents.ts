// AI module — intent inventory. Sprint 11 task 2.
//
// The full v1.0 intent class registry. ~50 intents per
// docs/_reference/D14-ambient-ai-architecture.md §9.1 (multi-vital
// expansion of the BP-only baseline in docs/07-ai-assistant.md §3).
//
// Each intent declares its patterns, response mode, and (for EDUCATE
// or DEFER) the linked card or DEFER template trigger. Patterns are
// case-insensitive; the router lowercases the input before matching.
//
// Card ids must exist in src/learn/articleIndex.gen.ts. The drift
// detector + voice-lint articles test ensure those don't disappear.
//
// Pattern style:
//   - Use word-boundary anchors (\b) where partial-word collisions
//     would cause false positives ("predict" inside "predilection").
//   - Avoid greedy alternations across high-traffic words ("normal",
//     "high") without context — those become any-pattern-matches-any-input.
//   - Each intent's first pattern is the canonical phrasing; later
//     patterns are synonyms.

import type { Intent } from './types';

// -----------------------------------------------------------------
// FAQ — factual definition questions.
// -----------------------------------------------------------------

const FAQ_INTENTS: Intent[] = [
  {
    id: 'faq.what-is-bp',
    category: 'faq',
    description: 'User asks for a definition of blood pressure',
    patterns: [
      /what (?:is|does) (?:blood pressure|bp)\b/i,
      /\bdefine (?:blood pressure|bp)\b/i,
      /\bmeaning of (?:blood pressure|bp)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-001',
  },
  {
    id: 'faq.what-is-systolic',
    category: 'faq',
    description: 'User asks what the top number means',
    patterns: [
      /what (?:is|does) (?:the )?systolic\b/i,
      /what (?:is|does) the (?:top|first) number\b/i,
      /\btop number (?:mean|meaning)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-005',
  },
  {
    id: 'faq.what-is-diastolic',
    category: 'faq',
    description: 'User asks what the bottom number means',
    patterns: [
      /what (?:is|does) (?:the )?diastolic\b/i,
      /what (?:is|does) the (?:bottom|second|lower) number\b/i,
      /\bbottom number (?:mean|meaning)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-005',
  },
  {
    id: 'faq.what-is-mmhg',
    category: 'faq',
    description: 'User asks about the mmHg unit',
    patterns: [
      /what (?:is|does) mmhg\b/i,
      /\bmmhg\b.*?(?:unit|stand|mean|explain)\w*/i,
      /\bmillimet(?:re|er)s? of mercury\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-001',
  },
  {
    id: 'faq.what-is-spo2',
    category: 'faq',
    description: 'User asks for a definition of SpO2',
    patterns: [
      /what (?:is|does) (?:spo2|spo₂|blood oxygen)\b/i,
      /what does (?:s.?p.?o.?2|spo2) (?:mean|stand for)\b/i,
      /\b(?:spo2|spo₂|blood oxygen) (?:explained|defined)\b/i,
      /\boxygen (?:saturation|level|explained)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'spo2-001',
  },
  {
    id: 'faq.what-is-resting-hr',
    category: 'faq',
    description: 'User asks what resting heart rate is',
    patterns: [
      /what (?:is|does) (?:a )?resting heart rate\b/i,
      /what'?s a normal resting (?:hr|heart rate)\b/i,
      /\bwhat (?:is|does) rhr\b/i,
      /\brhr\b.*?(?:normal|range)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'hr-001',
  },
  {
    id: 'faq.what-is-sleep-score',
    category: 'faq',
    description: 'User asks how the sleep score is calculated',
    patterns: [
      /how (?:is|do you) (?:my )?sleep score (?:calculated|computed|made)\b/i,
      /how (?:is|do you) (?:calculate|compute|score) sleep\b/i,
      /what'?s a good sleep score\b/i,
      /\bsleep score (?:mean|work|come from|explained)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'sleep-002',
  },
  {
    id: 'faq.what-do-stages-mean',
    category: 'faq',
    description: 'User asks what BP stages (Stage 1, Stage 2, etc.) mean',
    patterns: [
      /what (?:is|does) stage [12]\b/i,
      /what does (?:elevated|stage one|stage two) mean\b/i,
      /\bbp (?:stages|tiers)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-002',
  },
];

// -----------------------------------------------------------------
// READING — single-reading interpretation.
// -----------------------------------------------------------------

const READING_INTENTS: Intent[] = [
  {
    id: 'reading.is-this-bp-normal',
    category: 'reading',
    description: 'User asks if a specific BP reading is in range',
    patterns: [
      /is\s+(?:this|that|my)\s+(?:bp|blood pressure|reading)\s+(?:normal|in range|ok|okay|fine|alright)\b/i,
      /should i (?:be )?worr(?:y|ied) about (?:this|my) (?:bp|reading)\b/i,
      /\bis\s+\d{2,3}\/\d{2,3}\s+(?:normal|ok|okay)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-008',
  },
  {
    id: 'reading.why-was-this-bp-high',
    category: 'reading',
    description: 'User asks why a single reading was higher than usual',
    patterns: [
      /why (?:was|is) (?:this|my) (?:bp|reading|blood pressure)? ?(?:so |this )?high\b/i,
      /\b(?:reading|bp) higher than usual\b/i,
      /\bwhat made (?:this|my) bp (?:go )?up\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-008',
  },
  {
    id: 'reading.what-does-this-bp-mean',
    category: 'reading',
    description: 'User asks for an interpretation of the latest reading',
    patterns: [
      /what does (?:this|that|my) (?:bp |reading )?mean\b/i,
      /\binterpret (?:my|this) reading\b/i,
      /\bexplain (?:this|my) bp\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-001',
  },
  {
    id: 'reading.is-this-hr-normal',
    category: 'reading',
    description: 'User asks if a specific HR value is normal',
    patterns: [
      /is\s+\d{2,3}\s*(?:bpm|beats)\s*(?:normal|ok|okay|fine|alright)\b/i,
      /is (?:my|this) (?:resting )?(?:hr|heart rate) (?:normal|ok)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'hr-001',
  },
  {
    id: 'reading.is-this-spo2-normal',
    category: 'reading',
    description: 'User asks if a specific SpO2 percent is normal',
    patterns: [
      /is\s+\d{2,3}\s*(?:%|percent)?\s*(?:oxygen|spo2|spo₂)\s*(?:normal|ok|okay)\b/i,
      /is (?:my|this) (?:oxygen|spo2)\s+(?:normal|ok)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'spo2-001',
  },
  {
    id: 'reading.is-this-sleep-good',
    category: 'reading',
    description: 'User asks if last night was a good sleep',
    patterns: [
      /(?:was|is) (?:that|last night|my sleep) (?:good|ok|okay|fine)\b/i,
      /how (?:did|was) (?:i|my) sleep (?:last night|tonight)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'sleep-001',
  },
  {
    id: 'reading.is-this-step-count-good',
    category: 'reading',
    description: 'User asks about today\'s step count',
    patterns: [
      /(?:is|are)\s+\d{1,3},?\d{0,3}\s*steps\s*(?:good|enough|ok)\b/i,
      /am i walking enough\b/i,
      /how many steps should i (?:take|do|get)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'activity-002',
  },
];

// -----------------------------------------------------------------
// PATTERN — multi-reading / cross-vital observations.
// -----------------------------------------------------------------

const PATTERN_INTENTS: Intent[] = [
  {
    id: 'pattern.this-week-bp',
    category: 'pattern',
    description: 'User asks how BP looked this week',
    patterns: [
      /how (?:was|did) (?:my )?bp(?: do)? this week\b/i,
      /\bbp (?:this|last) week\b/i,
      /\bweekly (?:bp|reading) summary\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-003',
  },
  {
    id: 'pattern.morning-vs-evening',
    category: 'pattern',
    description: 'User asks why morning readings differ from evening',
    patterns: [
      /(?:morning|am) (?:vs|versus|compared to|different from) (?:evening|pm|night)\b/i,
      /why (?:is|are) (?:my )?morning(?: bp| readings)? higher\b/i,
      /\bmorning surge\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'changes-001',
  },
  {
    id: 'pattern.compared-to-last-month',
    category: 'pattern',
    description: 'User asks how this month compares to last',
    patterns: [
      /\bcompared (?:to|with) last (?:month|week)\b/i,
      /how does (?:my|this) bp compare (?:to|with) last (?:month|week)\b/i,
      /\b(?:trend|change) over the (?:last|past) (?:month|few weeks)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-003',
  },
  {
    id: 'pattern.bp-going-up',
    category: 'pattern',
    description: 'User notices a sustained rise in BP',
    patterns: [
      /(?:my )?bp (?:is )?(?:going|trending|creeping) up\b/i,
      /\b(?:numbers|readings) (?:are )?(?:rising|climbing|getting higher)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'numbers-008',
  },
  {
    id: 'pattern.bp-going-down',
    category: 'pattern',
    description: 'User notices a sustained drop in BP',
    patterns: [
      /(?:my )?bp (?:is )?(?:going|trending) down\b/i,
      /\b(?:numbers|readings) (?:are )?(?:dropping|getting lower)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-003',
  },
  {
    id: 'pattern.sleep-and-bp',
    category: 'pattern',
    description: 'User asks how sleep affects BP',
    patterns: [
      /\b(?:does|how (?:does|much)) sleep (?:affect|impact|change|move) (?:my )?bp\b/i,
      /\b(?:sleep|rest) (?:and|vs|impact on) (?:bp|blood pressure)\b/i,
      /why (?:is|are) (?:my )?morning bp high\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-001',
  },
  {
    id: 'pattern.activity-and-hr',
    category: 'pattern',
    description: 'User asks how walking/activity changes HR',
    patterns: [
      /\b(?:does|how does) (?:walking|exercise|activity|movement) (?:affect|change) (?:my )?(?:heart rate|hr|resting hr)\b/i,
      /\b(?:steps|exercise|activity) (?:and|vs) (?:resting )?(?:heart rate|hr)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-002',
  },
  {
    id: 'pattern.spo2-night-dip',
    category: 'pattern',
    description: 'User asks why SpO2 drops overnight',
    patterns: [
      /why (?:does|is) (?:my )?(?:oxygen|spo2|spo₂) (?:drop|dip|fall) (?:at night|overnight|when (?:i|i'?m) sleeping)\b/i,
      /\bovernight (?:oxygen|spo2) (?:dip|drop|low)\b/i,
      /\b(?:spo2|spo₂|oxygen) (?:dips?|drops?|falls?) overnight\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'spo2-002',
  },
  {
    id: 'pattern.what-correlations-mean',
    category: 'pattern',
    description: 'User asks what the correlation cards mean',
    patterns: [
      /what (?:is|does|are) (?:a )?correlation(?:s)?\s*(?:mean|do)?\b/i,
      /\bhow does (?:leiko|the app) find (?:a )?correlation\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-003',
  },
  {
    id: 'pattern.weekly-summary-explanation',
    category: 'pattern',
    description: 'User asks about the weekly summary',
    patterns: [
      /\b(?:weekly|sunday) summary\b/i,
      /what'?s in (?:the|my) weekly summary\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'corr-003',
  },
];

// -----------------------------------------------------------------
// TROUBLESHOOT — device or sync questions.
// -----------------------------------------------------------------

const TROUBLESHOOT_INTENTS: Intent[] = [
  {
    id: 'troubleshoot.watch-not-syncing',
    category: 'troubleshoot',
    description: 'User says the watch isn\'t syncing',
    patterns: [
      /watch (?:isn'?t|is not|won'?t) sync\w*\b/i,
      /\b(?:no|not) sync\w*\b/i,
      /\b(?:bluetooth|ble) (?:not )?connect\w*\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      "Bring the watch close to the phone, open Leiko, and pull down on the home screen to refresh. If it still doesn't pull in, restart the watch and try again. If the problem keeps coming back, tap Settings → Watch for the unpair-and-pair-again flow.",
  },
  {
    id: 'troubleshoot.battery',
    category: 'troubleshoot',
    description: 'User asks about watch battery',
    patterns: [
      /\bwatch battery\b/i,
      /how long does the watch (?:battery )?last\b/i,
      /\b(?:charge|charging) the watch\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      'A full charge usually lasts five to seven days with continuous heart rate on. The charger is the magnetic puck that came in the box. Most people charge the watch while taking a shower — the band wipes clean with a damp cloth.',
  },
  {
    id: 'troubleshoot.no-bp-readings',
    category: 'troubleshoot',
    description: 'User\'s BP readings haven\'t come through',
    patterns: [
      /\bno (?:bp|blood pressure) readings?\b/i,
      /\b(?:my )?readings (?:aren'?t|are not) showing\b/i,
      /where (?:are|is) my (?:bp |reading)\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      "BP readings have to be taken on the watch first — the app pulls them in once the watch is in range. Open the watch, take a reading, then open Leiko and pull down on the home screen. If the watch took a reading but the app still doesn't show it, tap Settings → Watch and re-pair.",
  },
  {
    id: 'troubleshoot.no-hr-data',
    category: 'troubleshoot',
    description: 'User\'s HR data is missing',
    patterns: [
      /\b(?:no|missing) (?:hr|heart rate) (?:data|reading)\b/i,
      /\b(?:hr|heart rate) data (?:missing|gone|not (?:showing|tracking))\b/i,
      /heart rate (?:isn'?t|is not) (?:showing|coming through|tracking)\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      'Auto heart-rate tracking has to be turned on in Settings → Vital streams. Once it\'s on, the watch samples every few minutes when you\'re wearing it. If the values still look empty, the watch may have been off-wrist for the day.',
  },
  {
    id: 'troubleshoot.no-sleep-data',
    category: 'troubleshoot',
    description: 'User\'s sleep wasn\'t tracked',
    patterns: [
      /\b(?:no|missing) sleep (?:data|tracking|reading)\b/i,
      /watch didn'?t track (?:my )?sleep\b/i,
      /\bsleep (?:didn'?t|did not) record\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      "The watch tracks sleep automatically when it's on your wrist overnight. If a night didn't record, the most common reason is the watch came off, or the battery dropped before morning. The chart fills in on the next sync.",
  },
  {
    id: 'troubleshoot.cuff-feels-wrong',
    category: 'troubleshoot',
    description: 'Reading feels wrong on the watch',
    patterns: [
      /\b(?:reading|cuff) feels (?:wrong|off|weird)\b/i,
      /\b(?:bp|reading) (?:way )?too (?:high|low)\b/i,
      /\bdoes(?:n'?t| not) feel right\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      "Sit still for two minutes before taking a reading. The arm should be supported at heart height, the cuff snug but not tight, and you shouldn't be talking. If the number still feels off after a calmer second reading, mention it at your next visit — your doctor can compare it against a clinic measurement.",
  },
];

// -----------------------------------------------------------------
// HOW-TO — app feature questions.
// -----------------------------------------------------------------

const HOWTO_INTENTS: Intent[] = [
  {
    id: 'how-to.take-a-reading',
    category: 'how-to',
    description: 'User asks how to take a reading',
    patterns: [
      /how (?:do i|to) take a (?:bp|reading|measurement)\b/i,
      /\btake a reading on the watch\b/i,
      /\bnew reading\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      "On the watch, swipe to the BP face and tap the round button. Sit still for two minutes first. The watch tightens, holds, then shows the reading. The app picks it up on the next sync — usually within a minute when the phone is nearby.",
  },
  {
    id: 'how-to.share-with-doctor',
    category: 'how-to',
    description: 'User asks how to share readings with a doctor',
    patterns: [
      /how (?:do i|to) (?:share|export|send) (?:my )?(?:readings|data|trend) (?:with|to) (?:my |the )?doctor\b/i,
      /\bdoctor (?:pdf|export|report)\b/i,
    ],
    responseMode: 'EDUCATE',
    cardId: 'doctor-003',
  },
  {
    id: 'how-to.invite-caregiver',
    category: 'how-to',
    description: 'Self-buyer asks how to invite a caregiver',
    patterns: [
      /how (?:do i|to) (?:add|invite) (?:a )?caregiver\b/i,
      /\binvite caregiver\b/i,
      /\bshare (?:my )?readings? with (?:my )?(?:family|kids|son|daughter|wife|husband)\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      'Open Settings → Connect with someone. Leiko creates a six-digit code; share it, and when they enter it in their Leiko app you two are connected. Blood pressure is always shared; you choose HR, SpO2, sleep, and activity per person in Settings → Who sees my readings.',
  },
  {
    id: 'how-to.add-family-member',
    category: 'how-to',
    description: 'User asks how to add a family member',
    patterns: [
      /how (?:do i|to) (?:add|invite) (?:a )?(?:family|sibling|spouse|son|daughter)\b/i,
      /\badd my (?:spouse|partner|husband|wife|son|daughter|sibling)\b/i,
      /\binvite code\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      'Open Settings → Connect with someone to get a six-digit code to share, or Settings → Enter a code if they sent you one. Whoever wears the watch shares their readings; the other follows.',
  },
  {
    id: 'how-to.export-data',
    category: 'how-to',
    description: 'User asks how to export their data',
    patterns: [
      /\b(?:export|download)(?:\s+(?:all|my))*\s+(?:data|readings)\b/i,
      /\b(?:csv|spreadsheet) export\b/i,
    ],
    responseMode: 'ANSWER',
    answerTemplate:
      'Open the Trends tab. Tap Share with doctor. The PDF download is part of Plus; once you tap, you can email it, save it to Files, or print directly. CSV export lands in a future release.',
  },
];

// -----------------------------------------------------------------
// DEFER — explicitly out-of-scope or doctor-territory questions.
// -----------------------------------------------------------------

const DEFER_INTENTS: Intent[] = [
  {
    id: 'defer.medication-bp',
    category: 'defer',
    description: 'Specific BP medication advice (lisinopril, amlodipine, etc.)',
    patterns: [
      /\b(?:lisinopril|amlodipine|losartan|metoprolol|atenolol|hydrochlorothiazide|hctz|ramipril|enalapril|valsartan|olmesartan)\b/i,
      /\b(?:ace inhibitor|arb|beta[- ]blocker|calcium channel|diuretic)\b/i,
      /\bbp (?:meds?|medication|pills?)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'medication',
  },
  {
    id: 'defer.medication-other',
    category: 'defer',
    description: 'Generic medication advice / dose changes',
    patterns: [
      /\b(?:should i take|how much|what dose|dose of|increase|decrease|switch) (?:my )?med(?:ication)?s?\b/i,
      /\bswitch(?:ing)? (?:my )?(?:meds|medication|pills|tablet)\b/i,
      /\btake more (?:of )?(?:my )?(?:medication|meds|pills)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'medication',
  },
  {
    id: 'defer.symptom-cardiac',
    category: 'defer',
    description: 'Cardiac symptom interpretation (chest pain, palpitations, AFib)',
    patterns: [
      /\b(?:chest pain|chest tight\w*|palpitation|skipping (?:beats|a beat)|fluttering)\b/i,
      /\b(?:could this be|is this|do i have) (?:a )?(?:heart attack|afib|a-?fib|arrhythmia)\b/i,
      /\bracing heart\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'symptom',
  },
  {
    id: 'defer.symptom-respiratory',
    category: 'defer',
    description: 'Respiratory symptom interpretation (apnea, breathlessness)',
    patterns: [
      /\b(?:do (?:i|you|she|he|they) have|could this be|does (?:she|he|they|mum|dad) have) (?:sleep )?apnea\b/i,
      /\bhas (?:she|he|they|mum|dad) got (?:sleep )?apnea\b/i,
      /\b(?:short of breath|trouble breathing|breathless)\b/i,
      /\b(?:cpap|sleep study)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'symptom',
  },
  {
    id: 'defer.symptom-stress',
    category: 'defer',
    description: 'Stress / anxiety symptom escalation',
    patterns: [
      /\b(?:panic attack|anxiety attack)\b/i,
      /\b(?:this|that|these )?(?:numbers? )?(?:is |are )?giving me (?:anxiety|panic)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'mental_health_crisis',
  },
  {
    id: 'defer.dose-change',
    category: 'defer',
    description: 'Dose change recommendations',
    patterns: [
      /\b(?:increase|decrease|change|adjust) (?:my )?dose\b/i,
      /\b(?:how often should i|when should i) take\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'medication',
  },
  {
    id: 'defer.diagnosis',
    category: 'defer',
    description: 'Request to label a condition — always deferred to the doctor',
    patterns: [
      /\b(?:do i have|am i|have i got) (?:hypertension|high blood pressure|heart disease|diabetes|diabetic)\b/i,
      /\bam i diabetic\b/i,
      /\b(?:diagnose|diagnos\w+) me\b/i,
      /\bbased on these (?:numbers|readings),? what (?:condition|disease|do i have)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'symptom',
  },
  {
    id: 'defer.afib-detection',
    category: 'defer',
    description: 'User asks if the watch detects AFib',
    patterns: [
      /\b(?:does|can|will) (?:this|the|it) ?(?:watch)? ?(?:detect|find|catch) a-?fib\b/i,
      /\bdoes (?:it|the watch) catch a-?fib\b/i,
      /\bafib alert\b/i,
      /\bwill the watch detect a-?fib\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'symptom',
  },
];

// -----------------------------------------------------------------
// OUT-OF-SCOPE — pregnancy / paediatric / mental-health-crisis / etc.
// -----------------------------------------------------------------

const OOS_INTENTS: Intent[] = [
  {
    id: 'oos.pregnancy',
    category: 'oos',
    description: 'Pregnancy-related question',
    patterns: [
      /\b(?:i'?m|i am|while) (?:pregnant|expecting)\b/i,
      /\bbreast.?feed\w*\b/i,
      /\bpregnancy (?:bp|blood pressure)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'pregnancy',
  },
  {
    id: 'oos.pediatric',
    category: 'oos',
    description: 'Question about a child\'s readings',
    patterns: [
      // Clinical-context pediatric only — must be ABOUT a vital, not
      // just incidentally mention a child (so "how do I add my
      // daughter" stays a how-to.add-family-member match).
      /\b(?:bp|blood pressure|reading|readings|hr|heart rate|spo2|spo₂|oxygen|sleep|measurement|number|numbers) (?:for|on|of) (?:my )?(?:child|kid|son|daughter|baby|toddler|teenager?)\b/i,
      /\b(?:my|the|her|his) (?:child|kid|son|daughter|baby|toddler|teenager?)'?s? (?:bp|blood pressure|reading|hr|heart rate|spo2|sleep|number|numbers)\b/i,
      /\bfor my (?:child|kid|son|daughter|baby)\b/i,
      /\bshould (?:my )?(?:child|kid|son|daughter) (?:wear|use|have)\b/i,
      /\b(?:under )?\s?1[0-7]\s?(?:years? old|yo)\s*,?\s*(?:can|should|use)/i,
      /\bp(?:a)?ediatric\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'paediatric',
  },
  {
    id: 'oos.mental-health-crisis',
    category: 'oos',
    description: 'Mental health crisis indicators',
    patterns: [
      /\b(?:thinking about|want to|going to|gonna)\s+(?:hurt(?:ing)?|harm(?:ing)?|cut(?:ting)?)\s+(?:my\s?self)\b/i,
      /\bsuicid\w*\b/i,
      /\b(?:feel|feeling) (?:hopeless|worthless)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'mental_health_crisis',
  },
  {
    id: 'oos.suicidal-ideation',
    category: 'oos',
    description: 'Direct mentions of self-harm',
    patterns: [
      /\b(?:kill(?:ing)?|end(?:ing)?)\s+my\s?self\b/i,
      /\bdon'?t want to (?:live|be here)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'mental_health_crisis',
  },
  {
    id: 'oos.substance-abuse',
    category: 'oos',
    description: 'Substance abuse questions',
    patterns: [
      /\b(?:cocaine|heroin|amphetamine|meth)\b/i,
      /\b(?:i drink|i'?m drinking|alcohol).*?(?:every day|too much|problem)\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'generic',
  },
  {
    id: 'oos.life-threatening-emergency',
    category: 'oos',
    description: 'User describes an immediate emergency',
    patterns: [
      /\b(?:i'?m having|having) a (?:heart attack|stroke)\b/i,
      /\bcan'?t breathe\b/i,
      /\bcollapsing\b/i,
    ],
    responseMode: 'DEFER',
    deferTrigger: 'mental_health_crisis',
  },
];

// -----------------------------------------------------------------
// Final registry — the order here matters: more specific intents
// (DEFER, OOS) come first so they shortcut before broader patterns
// like "what is sleep score".
// -----------------------------------------------------------------

export const INTENTS: ReadonlyArray<Intent> = [
  ...OOS_INTENTS,
  ...DEFER_INTENTS,
  ...TROUBLESHOOT_INTENTS,
  ...HOWTO_INTENTS,
  ...PATTERN_INTENTS,
  ...READING_INTENTS,
  ...FAQ_INTENTS,
];

export const INTENT_BY_ID: Readonly<Record<string, Intent>> = INTENTS.reduce<
  Record<string, Intent>
>((acc, i) => {
  acc[i.id] = i;
  return acc;
}, {});

export const INTENT_IDS: ReadonlyArray<string> = INTENTS.map(i => i.id);
