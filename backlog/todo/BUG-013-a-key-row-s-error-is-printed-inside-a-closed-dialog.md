---
id: BUG-013
title: A key row's error is printed inside a closed dialog
type: bug
priority: p3
created: 2026-09-09T11:58+08:00
parent: US-079
area: web
resolution:
---

## Context

On the models screen, `Make default` and `Remove` are buttons on a key's row on
the page. Both write their failure into `setError`, and that error is rendered
inside the add-key `<dialog>`, which is closed while somebody is pressing those
buttons.

So a refused delete or a refused default answers with nothing at all. The row
stays where it is, no message appears, and the only reading available to the
person is that the button does not work.

Found on 2026-09-09 while closing US-086. It is older than that ticket and
independent of it: the two actions have shared one error state since US-079
put them in the same component.

The fix is a second piece of state for the page's own messages, rendered beside
the key list rather than inside the dialog. Keep them separate rather than
moving the whole message out: a save that fails inside the dialog must show its
message where the values that caused it are.

## Acceptance

- [ ] A refused `Remove` shows its message beside the key list.
- [ ] A refused `Make default` shows its message beside the key list.
- [ ] A refused key add still shows its message inside the dialog.

## Notes

Neither path has been seen to fail against a real server. The route answers
404 for a key that is already gone, which is the likely way somebody meets
this: two tabs open, one row deleted twice.

## Log

- 2026-09-09T11:58+08:00 — Written, while closing US-086.
