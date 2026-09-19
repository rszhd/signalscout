---
name: capture-fixture
description: Capture or refresh a fixture from a real provider or a real model. Use when a parser, a prompt or a provider endpoint changes, or when a test needs a payload that does not exist yet. Never write a payload by hand.
---

# Capture a fixture

A fixture for someone else's API is captured, not written. The reasons and
the costs are in `docs/instruments.md`; this is the order.

1. Find the script beside the fixtures:
   `packages/engine/src/sources/providers/<provider>/<platform>-fixtures/capture.mjs`,
   or a `capture:*` script in `packages/engine/package.json` for a model.
   Read its header for the flags (`--only=comments`, `--lean`, `--model=`).
2. Read the cost line for it in `docs/instruments.md` and say the number
   before running. Anything over a few cents is the owner's call.
3. Run it with the key in the environment, never on the command line.
4. **Read every file it wrote before committing.** Search for names, handles
   and URLs that identify a person. Three captures leaked identity past a
   scrubber that looked right. Fix the scrubber, not the file.
5. Check `ledger.json` beside the fixtures says what each call cost, and that
   `manifest.json` merged rather than replaced.
6. Replay: run the test file that reads the fixture. If an expected value
   moves, the behaviour changed — say which and why in the commit.
7. Put the numbers and the date in the ticket's Log.

`biome.json` excludes `fixtures/*.json` from formatting; do not format them.
