---
id: US-086
title: A saved dialog closes itself
type: feature
priority: p3
created: 2026-09-09T11:58+08:00
parent: US-079
area: web
resolution: done
---

## Context

**Both dialogs on the models screen stay open after a successful save.** The
job editor writes the setting, then prints "Saved." and waits. The add-key
dialog stores the key, clears its three fields and waits. Nothing else on the
page can be reached until somebody presses Close, and the thing they wanted to
see — the card now saying what the job runs, the key now in the list — is
behind the dialog they are still looking at.

The owner asked for the dialog to close on save. It is the right way round:
pressing Save is a person saying they are finished with the dialog, and the row
underneath is the confirmation. "Saved." above an unchanged form is a weaker
answer than the card itself changing.

**A failed save must still keep the dialog open**, with the message, because
that is the one case where the person is not finished and the values they
typed are the only copy.

## Acceptance

- [x] A successful job save closes the job dialog.
- [x] A successful key add closes the add-key dialog.
- [x] A save that the server refuses leaves the dialog open, with the error and
      the typed values intact.
- [x] Reopening a dialog shows no message left over from the last time it was
      open.

## Notes

The reset button — "Use instance defaults" — does not close the dialog, and
that is deliberate rather than an oversight. It is not a save: it takes the
job's own settings away, and the sentence it prints is the only place a person
reads what the job falls back to.

Two things next to this were found and not changed. `makeDefault` and `remove`
act on rows on the *page* but write their errors into the add-key dialog's
error state, so a failure there is printed inside a dialog that is closed and
nobody sees it. That is [BUG-013](../todo/BUG-013-a-key-row-s-error-is-printed-inside-a-closed-dialog.md).

## Log

- 2026-09-09T11:58+08:00 — Written.
- 2026-09-09T12:14+08:00 — Done. Both dialogs close on a successful write and
  stay open on a refused one. Opening either clears the message from last time.
  The "Saved." notice is gone: it would have been printed into a dialog nobody
  is looking at any more.

  Four tests, and both closing tests were confirmed to fail with the two
  `close()` calls removed.
