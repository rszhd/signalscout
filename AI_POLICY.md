# AI policy

This repository is written with an AI coding agent, and this page says
what that means for you.

## How this code is written

The owner writes with Claude Code. Most commits before 2026-09-22 carry a
`Co-Authored-By: Claude` trailer; that was the tool's default and it stopped
with this policy. The history is not rewritten. A commit after this date
that used a tool carries `Assisted-by:` instead, and the reason is in
*Trailers* below.

One human has read this code. There is no second maintainer. "Reviewed"
here means three things and not a fourth: the ticket's Acceptance list is
checked box by box, the test suite passes, and the ticket says what has
run live against a real provider and what has not. [AGENTS.md](AGENTS.md)
holds the rules the agent works under; they are the same rules you work
under.

## What you may do

**Use AI to write code.** Use it to write tests, comments and docs too.
There is no penalty for it, and a rule against it would be a rule the
owner breaks daily.

**Understand every line you submit.** A reviewer will ask why a line is
there, what happens at the edge, and what else calls it. Answer without
the tool. If you cannot, the change is not ready, whoever wrote it. This
is the whole policy, and the rest is how it is checked.

**Say what you used.** The pull request template asks: none, assisted, or
generated, and the tool. "Assisted" means you wrote it and the tool
helped. "Generated" means the tool wrote it and you read it. Both are
fine. A wrong answer is not.

## Trailers

A commit that used a tool carries:

```text
Assisted-by: Claude Opus 5 [Claude Code]
Signed-off-by: Your Name <your@email>
```

`git commit -s` adds the second line. It certifies you have the right to
submit the work, and it is the whole ceremony ([CONTRIBUTING.md](CONTRIBUTING.md)).

**Never `Co-authored-by:` a model.** That trailer names an author, and a
model cannot hold copyright or certify origin. Linux, Kubernetes, Fedora,
attrs and pip refuse it for the same reason. A `commit-msg` hook in this
repository refuses it too and says which trailer to use.

## Limits

- **One open pull request at a time** until your first is merged. After
  that, as many as you can answer questions about.
- **A `good first issue` is done by hand.** The label exists so a person
  learns the code. A generated patch on one is closed without review.
- **A security report states what was reproduced and how.** A report with
  no reproduction is closed. A report that a tool wrote and you did not run
  costs the owner an evening and you nothing; this rule makes it cost
  something.
- **Issues and discussions are written by you.** Use a tool to draft, then
  cut it to what you would say aloud. A page of generated prose is closed.

## Why

Not because the tools are bad. Because a change nobody can explain is a
change nobody can maintain, and the people who submit those are, so far,
mostly the people who did not read it. Ghostty wrote this rule first and
said it better: the policy is about the number of unqualified people
using AI, not about AI.
