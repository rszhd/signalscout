---
id: US-082
title: What the Models screen cost to get right
type: chore
priority: p3
created: 2026-09-09T03:50+08:00
parent: US-079
area:
resolution: done
---

## Context

On 2026-09-09 the Models screen was corrected seven times in one session, by
the owner, each time on the same page and mostly on the same class of fault.
This is the record of it, written because the tickets underneath say what the
code does and none of them says what it cost to arrive there.

The work itself closed as US-078, US-079, US-080 and US-081. This ticket is
about the shape of the session, and it is filed against the assistant that did
it rather than against the code.

## Notes

**What was asked, in order.**

1. A model key had to be entered for every job. → US-078 answered with a *rule*:
   a job borrows the key of any job on the same provider.
2. "It's confusing. Just allow multiple keys on the account, and each job picks
   one." → US-079 replaced the rule with a list, and deleted US-078 unshipped.
3. "Why still select a provider when the key already stored one?" → the key's
   provider began deciding the job's.
4. "No need for instance default provider." → the provider select lost its
   *Instance default* entry.
5. "Also filter models based on provider." → the model list became per provider.
6. "Test key button on a job." → US-080, then "allow test before save".
7. "Is the instance-key option only available if `.env` has one?" → it was not.
   Fixed, and then the whole fallback was scoped to signup by US-081.
8. "This UI is fucked up. Rebuild from scratch." → the screen was rebuilt.
9. "Why is *Use instance defaults* still there on a signup-enabled instance?" →
   it was still offering a fallback the machine could not serve.

**The pattern, which is the point of this file.** Every correction after the
second was the same class of fault: *a screen offering a choice the system
would refuse, or falling back to a thing that was not there.* Each was fixed
where it was found. Nothing went looking for its siblings until the owner asked
"please check other logics" at step 7, and that one sweep found four more —
including a real bug that predated the session, where an account moving a job
to another provider was sent the machine's key for a different one.

**Three faults are worth naming.**

- **Fixing the instance, not the class.** Seven rounds of one-line answers where
  one audit would have found most of them at once. The audit was only run when
  it was demanded.
- **A rule where a list belonged.** US-078 answered "I have to type this twice"
  with a borrowing rule nobody would ever read. The owner's own answer — a list
  and a picker — was simpler than the thing being fixed.
- **The layout never moved while the rules under it did.** Six corrections to
  what the fields meant, and the arrangement of those fields was untouched until
  the owner said the screen was a mess. It was: it still asked a question the
  key had already answered, and hid four jobs behind four disclosures.

**What was not wrong.** The tests caught nothing here, and could not have: every
fault was a screen offering something a person should not be offered, and the
suite asserted the behaviours that existed rather than the ones missing. The one
fault the suite *could* have caught — the cross-provider key — was found by
reading, not by running, and it now has three cases.

**Cost.** Four tickets, 1,554 tests, two migrations, one rebuilt screen, and an
afternoon of the owner's attention that should have gone somewhere else.

## Log

- 2026-09-09T03:50+08:00 — Written at the owner's request, at the end of the
  session it describes. Nothing in it is a plan; the fixes are in US-079,
  US-080 and US-081. It is here so the next reader of those three finds out
  what they cost as well as what they say.
