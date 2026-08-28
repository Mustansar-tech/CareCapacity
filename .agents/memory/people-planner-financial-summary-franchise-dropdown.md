---
name: PP Financial Summary franchise dropdown quirks
description: Why franchise auto-selection in the Day Rate Tracker's Financial Summary export can silently pick the wrong entity, and how it's guarded against.
---

The People Planner "Financial Summary" export's Franchise dropdown frequently
does **not** use the same clean name stored in `day_rate_franchises.franchise_name`.
Confirmed real-world divergences (verified live via screenshots), all in
`automation-engine.ts`'s `FRANCHISE_PP_OPTION_OVERRIDES` map:
- Different prefix: "Aberdeen" → "Home Instead Aberdeen", "West Fife" → "Home
  Instead West Fife and Kinross", "South Ayrshire" → "Home Instead South
  Ayrshire Kilmarnock".
- Combined-territory name: "North Lanarkshire" → "North Lanarkshire & Glasgow
  East", "Stirling" → "Stirling & Falkirk", "East Lothian" → "East Lothian and
  Midlothian".
- Live-in-care suffix spelling varies per franchise ("Live-In Care" vs "live
  in care" vs "- Live In Care") and is NOT consistent even within one office's
  own pair.

**Why:** fuzzy/normalized matching against the stored clean name silently
selected a sibling franchise's option (e.g. duplicated one office's revenue
into another's row), because substring/normalize matching can't distinguish
"North Lanarkshire" from "North Lanarkshire & Glasgow East" reliably, and
because a naive normalizer that deletes punctuation instead of replacing it
with a space merges words across a hyphen ("Live-In" → "livein"), breaking
comparisons against text spelled with real spaces.

**How to apply:** when adding/debugging a franchise here, get the exact dropdown
text from a live screenshot (do not guess) and add it to
`FRANCHISE_PP_OPTION_OVERRIDES` for an exact-label `selectOption()` call rather
than fuzzy matching. Selection is verified post-postback against whatever text
actually ends up chosen, with a keyboard type-ahead fallback and a hard
failure (never a silent wrong-franchise export) if it won't stick after
retries. Any text-normalize helper touching these names must replace
non-alphanumeric runs with a space, not delete them.
