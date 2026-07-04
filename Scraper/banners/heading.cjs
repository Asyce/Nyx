'use strict';
// ============================================================
// Character-name extraction from game8 banner-section sub-headings.
//
// Pure (no I/O) so it can be unit-tested; the caller still filters the
// returned candidates through its junk/roster checks — a candidate that
// isn't a real character (e.g. a teaser codename) gets dropped there.
//
// Heading shapes seen in the wild:
//   "Rossi in Phase 2 of Version 1.1"                         (Endfield)
//   "Zhuang Fangyi for Phase 1 of Version 1.2"                (Endfield)
//   "Camille Banner on 1.3 Phase 2"                           (Endfield)
//   "Arcane Teased for Version 1.4"                           (Endfield teaser)
//   "Promeia and Starlight Billy to Release in Version 2.8"   (ZZZ)
// ============================================================

const HEADING_CHAR_RE = new RegExp(
  '^(.+?)' +                       // the name(s), lazily
  '(?:\\s+banner)?' +              // optional "Banner" suffix after the name
  '\\s+(?:' +
    // "... in Phase 2 of Version 1.1" / "... on 1.3 Phase 2" / "... for Version 1.2"
    '(?:in|for|on)\\s+(?:phase|both\\s+phases?|version|\\d+\\.\\d+)' +
    // "... Teased for Version 1.4" (pre-announcement headings)
    '|(?:teased|revealed|announced|confirmed)\\s+for' +
    // "... to Release in Version 2.8"
    '|to\\s+(?:release|debut|arrive|launch)' +
  ')\\s+',
  'i'
);

// Returns the raw candidate names from a heading (split on "and"/"&"/","),
// or [] when the heading doesn't look like a character-banner heading.
function headingCharCandidates(text) {
  const m = String(text || '').replace(/\s+/g, ' ').trim().match(HEADING_CHAR_RE);
  if (!m) return [];
  return m[1]
    .split(/\s*(?:,|&|\band\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { headingCharCandidates, HEADING_CHAR_RE };
