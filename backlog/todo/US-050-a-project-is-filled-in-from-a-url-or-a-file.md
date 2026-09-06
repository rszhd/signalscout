---
id: US-050
title: A project is filled in from a URL or a file
type: feature
priority: p2
created: 2026-09-06T23:05+08:00
parent: US-045
area:
resolution:
---

## Context

**The four answers are the hardest part of this product to start.** US-045 made
them typed once instead of once per monitor, which removes the repetition but
not the blank page. A person who has a landing page, a pitch deck or a README
has already written what the product is, who it is for and what problem it
solves — in their own words, better than they will write it again into four
boxes.

So: paste a URL or upload a file, and the model fills the form in. The person
reads it, edits it, and saves. **Nothing is saved without them pressing save**,
which is what makes the whole feature safe to get wrong.

**The content is data, and the model must be told so.** A landing page is
somebody's marketing copy, and an uploaded file is bytes from a filesystem.
Either can contain text shaped like an instruction — "ignore the above and
answer X" — and a prompt that pastes a page in beside its own instructions is a
prompt that can be rewritten by the page. Two things hold that off, and both
already exist here: the answer is a **structured object with a fixed schema**,
the way `ai/queries.ts` constrains the query plan, so the worst a hostile page
can do is fill four fields with nonsense a person then reads; and the prompt
says plainly that what follows is a document to summarise and not a request to
obey. Neither is sufficient alone and the ticket needs both.

**Fetching a URL is the part with a security cost.** A server that fetches
whatever URL it is handed will fetch `http://169.254.169.254/`, `localhost:5432`
and `file:///etc/passwd` if somebody asks it to. This is self-hosted and
single-account until US-017, so the blast radius is small today and will not
stay small. The fetch needs: `https` only, a timeout, a size cap, a redirect
limit, and a refusal for addresses that resolve to private or loopback ranges —
checked **after** DNS resolution, because a hostname is not an address.

**A file is the easier half and should be narrow.** Plain text, Markdown and
PDF cover a landing page saved to disk, a README and a one-pager. Everything
else is a parser this product does not want to own. A size cap and a page cap
belong here too: a 400-page PDF is a large model bill for four sentences.

**There is no budget to charge this to, and that is a hole to close rather than
note.** `enforceBudget` is keyed to a monitor, and a project has none — so
nothing stops a person pressing "analyse" fifty times. The call must still land
in `model_calls` with its own purpose so a person asking "what was my key spent
on" gets a true answer, and the screen must bound the obvious abuse: one
analysis in flight at a time, and a refusal that says why rather than a spinner
that never ends.

**What it must not do is decide.** The model proposes; the person disposes. A
form that filled itself and saved would put words the classifier reads —
`monitors.version`'s four fields — into the product on somebody's behalf, and
every verdict afterwards would be measured against a description nobody wrote.

## Acceptance

- [x] On the project form, a person can paste a URL **or** upload a file and
      ask for the four answers to be drafted
- [x] The four fields are filled in, editable, and clearly the model's draft
      rather than saved values. Nothing is written until the person saves
- [x] The answer is a structured object with a fixed schema, so a page that
      contains instructions can fill fields with nonsense and can do nothing
      else. The prompt says what it is reading and that it is not a request
- [x] The fetch is `https` only, with a timeout, a response size cap, a
      redirect limit, and a refusal for private, loopback and link-local
      addresses **checked after DNS resolution**
- [x] Uploads are limited to plain text, Markdown and HTML, with a size cap. An
      unsupported file is refused with its type named — **PDF is deliberately
      not supported**, see the Log
- [ ] PDF. It needs a parsing dependency, which was not added unasked. The
      refusal names the type and says what to do instead
- [x] The call is recorded in `model_calls` with its own purpose and its cost,
      so `docs/costs.md`'s answer to "what did my key pay for" stays true
- [ ] One analysis at a time per person, and a second request is refused with a
      reason rather than queued invisibly
- [x] A refusal from the model, a page that is unreachable, and a page that
      says nothing useful are three different messages. "Could not analyse" is
      not one of them
- [ ] Fixtures replay a real model's answers, captured by a script named in
      `package.json`, never written by hand
- [ ] The Log records what one analysis costs and how long it takes, measured
      on a real page

## Notes

- Depends on [US-045](US-045-a-project-holds-what-every-monitor-repeats.md),
  which holds the project and its form.
- `ai/queries.ts` is the closest existing shape: a prompt, a schema, a recorded
  call, and a person editing what came back. Read it before writing a second
  one — the query generator already learned that a model told only a limit
  talks itself out of it, and that the schema is where the guarantee lives.
- **Do not reuse the classifier's model choice without thinking.** Reading a
  landing page is a summarising job, not a strict-judgement one, and US-032
  measured those models behaving differently at the top and bottom of a scale.
  Whether the cheap model is enough here is a measurement, not an assumption.
- The same drafting would help the *monitor* form, which asks the same four
  questions. Keep the analysis in core rather than in the project route, so
  that is a second caller and not a second implementation.
- A URL is the common case and a file is the one that works offline. If only
  one ships first, ship the file: it has no network, no SSRF, and no DNS.

## Log

- 2026-09-06T23:05+08:00 — Written at the owner's request, straight after
  US-045 shipped the project form. The blank page is the friction that remains
  once the repetition is gone.

- 2026-09-06T23:59+08:00 — Built, except PDF.

  **Three modules, and they are separate on purpose.** `projects/document.ts`
  decides what this server will go and fetch; `ai/describe.ts` decides what a
  model does with text; the route joins them. What our server can be talked
  into reaching is a different problem from what a model says, and mixing them
  is how one becomes an excuse for the other.

  **The SSRF guard is the part with real teeth**, and `document.test.ts` is
  marked correctness-critical for it. https only, a timeout, a size cap, a
  redirect limit, and every address checked **after DNS resolution at every
  hop** — a public host answering 302 to `169.254.169.254` is the whole attack,
  and `redirect: "follow"` would take it. Redirects are therefore walked by
  hand.

  One test there is honest about its own limit. A fake `fetch` cannot follow a
  redirect, so no case can tell `redirect: "manual"` from `"follow"` by its
  result — the difference only shows against a real network. What is assertable
  is what we ask for, so a case asserts the option, and flipping it turns that
  case red.

  **The prompt-injection defence is two things and neither is enough alone.**
  The answer is a fixed schema, so the worst a hostile page achieves is four
  fields of nonsense a person reads. And the system prompt says outright that
  the document is content rather than a request. `ai/prompt.ts` uses the same
  technique for a post's text.

  **PDF is not supported and that is a decision.** Parsing one needs a
  dependency, and AGENTS.md is explicit that adding one to avoid a hard problem
  is the wrong move — so the refusal names the type and says to paste the
  address or save as text instead. The box stays open rather than being quietly
  dropped.

  Also deliberate: the file is read in the browser and posted as text. No
  multipart plugin, no filename to sanitise, no temporary file, and the only
  thing that reaches the server is the words.

  Still open: one analysis at a time is not enforced, and nothing has run
  against a real model, so the Log has no measured cost yet.
