---
id: US-300
title: The project says how AI may be used, by the owner and by a contributor
type: chore
priority: p1
created: 2026-09-22T16:30+08:00
parent:
area: docs
resolution: shipped
---

## Context

This repository is written with an AI coding agent, and it says so nowhere
a contributor would look. CONTRIBUTING.md calls AGENTS.md a file "for
people and AI tools alike" and stops. A stranger who arrives with an agent
of their own will assume anything goes, and the first 2,000-line generated
pull request costs the owner a weekend.

The log has a second problem. 358 of 431 commits carry
`Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` and none carries
`Signed-off-by`. The project chose a DCO over a CLA, and a DCO works only
when the human signs. Naming a model as co-author is the trailer Linux,
Kubernetes, Fedora, attrs and pip explicitly refuse: a model cannot hold
copyright or certify origin, so the line weakens the chain of title the
DCO exists to keep. The ecosystem's answer is `Assisted-by:`, which says a
tool helped and the human is the author.

The policy to copy is Ghostty's: AI may write the code, the contributor
must be able to explain it without the tool, the tool is named in the pull
request, and the rule binds contributors more than maintainers — "not an
anti-AI stance, but the number of highly unqualified people using AI."
LLVM adds one rule this project wants: no AI on `good first issue`, because
the label exists to teach a person.

## Acceptance

- [x] `AI_POLICY.md` exists at the root and says, in this order: AI-written
      code is welcome; the contributor must understand every line and be
      able to answer a review question without the tool; the tool and the
      extent are disclosed in the pull request; a commit that used a tool
      carries `Assisted-by: <tool> [<harness>]` and never `Co-authored-by:`
      a model; every commit is signed off; a new contributor keeps one pull
      request open at a time; `good first issue` tickets are done by hand;
      a security report states what was reproduced and how, and one with no
      reproduction is closed.
- [x] It says plainly that the owner writes with an agent, that the owner is
      the one human who has read the code, and what "reviewed" means here
      (the Acceptance list, the tests, and what ran live).
- [x] CONTRIBUTING.md links it from *Before you write code*, and the DCO
      section says `-s` is not optional.
- [x] The pull request template (US-294) has an *AI use* line: none /
      assisted / generated, plus the tool.
- [x] `.githooks/pre-commit`, or a `commit-msg` hook beside it, refuses a
      commit whose message names a model in `Co-authored-by:`, and says
      which trailer to use instead. It does not refuse a missing sign-off;
      CI does that on pull requests from outside.
- [x] The owner's own agent configuration writes `Assisted-by:` and signs
      off from this ticket onward. The commit that lands this ticket is the
      first.
- [x] Existing history is not rewritten. The policy says the old trailer is
      there and why it stopped.

## Notes

- Ghostty's two files are the shape: `CONTRIBUTING.md` for the rule in one
  paragraph, `AI_POLICY.md` for the whole thing.
- Trailer format from the kernel: `Assisted-by: Claude Opus 5 [Claude Code]`.
- The owner's harness adds the co-author line by default; the project's
  `CLAUDE.md` (which imports AGENTS.md) takes precedence and can replace
  it. That is a change to AGENTS.md's commit section, not to the harness.
- Policies compared on 2026-09-22:
  https://github.com/melissawm/open-source-ai-contribution-policies

## Log

- 2026-09-22T16:30+08:00 — Written after a review of how projects that accept AI-assisted work state their rules, and of this repository's own log.
- 2026-09-22T16:40+08:00 — Shipped. AI_POLICY.md, the PR template, the `commit-msg` hook, a CI step that checks sign-off on fork pull requests, and the trailer rule in AGENTS.md. The hook was run by hand on a co-authored message (refused) and an assisted one (passed). The CI step is not proved until a fork opens a pull request; its jq filter was run on two sample commits.
