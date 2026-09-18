---
id: US-222
title: A triage drop is checked against a score
type: feature
priority: p1
created: 2026-09-18T19:45+08:00
parent: US-221
area: pipeline
resolution: shipped
---

## Context

US-221 made triage stricter and measured the saving: 13 of 46 comments kept
where 19 were kept before. That number says the stage drops **more**. It cannot
say the stage drops the **right ones**.

The gap is structural, not an oversight. A triage drop writes a `filter_drops`
row and no score, because never buying the classification is the whole point of
the stage. So the product has no way to know what a dropped item was worth, and
a person cannot notice the mistake either: a deleted lead leaves no row, no
inbox entry and nothing to look at.

The only way to answer it is to buy those classifications once, deliberately,
outside the pipeline. Two instruments do that.

`capture:scores` does it for the fifty hand-labelled fixtures, where a hand
label says what each item is. `live:triage-score` does it for **everything this
instance has stored** — every platform, posts and replies, against the monitors
the items were really collected for — because fifty items from two Reddit
threads is not a distribution and every file that touches them says so.

Both record the verdict rather than obeying it: an item triage refuses is
classified anyway.

## Acceptance

- [x] One definition of the fifty fixture items, read by the triage capture and
      the scoring capture alike, so a score can sit beside a verdict.
- [x] `capture:scores` classifies all fifty and reports the drops by score band
      against the default threshold.
- [x] `live:triage-score` samples the stored posts per platform and kind, runs
      triage and then classification on every sampled item, and reports the
      drops against **each monitor's own** `min_score`.
- [x] Neither writes a match, a drop or a ledger row.
- [x] The numbers are written into this ticket with the model and the date.
- [x] Every capture takes `--model=` and writes a file per model, so a new
      model is one command and never overwrites the evidence for the old one.
- [x] A score is bought once and reused, keyed on the classifier's own prompt,
      so a triage round is not read through the classifier's drift.
- [x] The suite goes red when the classifier's prompt moves and the recorded
      scores become claims about a prompt that no longer exists.
- [x] `capture:compare` puts every captured pair in one table.
- [x] `pnpm test`, lint and typecheck pass.

## Notes

- The per-platform cap is not decoration. Reddit holds more than half of
  everything stored, so one undivided sample would be a Reddit measurement
  wearing six platforms' names.
- `live:triage-score` writes nothing on purpose. An instrument that wrote
  matches would put its own experiment in somebody's inbox, and the spend would
  reach the budget guard for work no account asked for.

## Log

- 2026-09-18T19:45+08:00 — Asked for by the owner: "classify them then we know
  whether triage works … so we know whether triage get rid of high score posts",
  and then "add all kind of test data use cases from our db so far, all
  platform, post, comment".
- 2026-09-18T19:52+08:00 — **Round 1 on the fifty**, `gpt-5.6-luna` both sides.
  Triage refused 34 and kept 15. Of the 34 refused, the highest scored **41**
  and none reached 60. All three worked examples that are leads survived, at
  66, 86 and 96. `low-intent` scored 7 and was refused, which is a
  classification saved. **Triage deleted no lead.** It also kept 10 items
  scoring under 30: the saving still on the table.
- 2026-09-18T20:05+08:00 — **The whole stored sample**, 213 items over 18
  monitors, every platform and both kinds, capped at 30 a cell. $0.1432.
  Dropped 166 and kept 42. It kept **every** item scoring 80 or more and 10 of
  the 12 scoring 60–79. Eleven drops would have matched their own monitor's
  minimum, and reading them is the point: five are YouTube marketing videos ("I
  Built an AI That Finds My SaaS Customers on Reddit"), two are LinkedIn promo
  posts, one is somebody selling to meme-coin traders. Those are what triage is
  told to refuse, and the classifier over-scores them because it weighs the
  subject and not the author. On that evidence the stage improves the inbox
  rather than only the bill. `youtube/post` kept 0 of 27 and `instagram/post` 0
  of 15, which is worth its own look.
- 2026-09-18T20:20+08:00 — **Round 2 on the fifty.** The prompt gained three
  rules: text with nobody in it is a `no` (moderator notices, bare agreement,
  jokes, a bare link), short-and-asking is still a yes while short-and-agreeing
  is not, and a person asking for a product this one does not make is a `no`.
  Kept fell 15 → 11, junk kept 10 → 8, leads still 3 of 3, highest drop 43.
  Asking kept fell 3 → 2, and the score fixture is why that is not a fault: the
  newly refused asker is "I thought detox was useful there. Is it not?", which
  scores **4**.
- 2026-09-18T20:24+08:00 — **Three rules did not fire.** A joke, a moderator's
  notice about vendor spam and somebody offering to sell help all came back
  `yes` although the prompt names each case. Luna does not follow a long rule
  list. Recorded rather than fixed: the next notch is a free rule in code or a
  dearer triage model, not more prose.
- 2026-09-18T20:40+08:00 — The owner asked for the instruments to be reusable,
  "because new models keep emerging and we gonna keep experimenting". Model
  flags everywhere, one file per model and per pair, `pinned.ts` naming what
  the product sends, a prompt-keyed score cache, `capture:compare`, and a test
  that goes red when the classifier's prompt moves. 2101 tests, lint and
  typecheck pass.
