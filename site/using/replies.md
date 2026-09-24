# Reply drafts

When a match is worth answering, SignalScout can write a first draft of the
reply. You edit it, copy it, and post it yourself. **Nothing is ever posted
from SignalScout.**

```mermaid
flowchart TD
  match["A match"] -->|Draft reply| draft["A draft<br/>in your voice"]
  draft --> edit["You edit it"]
  edit -->|Copy draft| clip["Your clipboard"]
  clip --> post["You post it<br/>on the platform"]
  post -->|Mark as replied| marked["The match says Replied"]
```

## Draft a reply

Open the match in your inbox and press **Draft reply**. The draft appears in
an editable box.

<!-- screenshot: a match with its reply draft open -->

- **Draft again** writes a new version.
- **Voice and guidance** opens two choices for this one reply: a **Writing
  voice** from your saved voices, and **Customize**, where you add guidance,
  for example: *Answer the pricing question first, and keep it to three
  sentences.* The guidance applies to this draft only.
- **Copy draft** puts the text on your clipboard. SignalScout then asks
  **Did you post it?** Press **Yes, mark as replied** after you post, so the
  inbox shows that you answered. Copying alone marks nothing.

Read the draft before you post it. It carries your name into somebody else's
conversation.

**The voice decides everything about a draft**, including what it says about
your product. SignalScout adds no rules of its own: the AI is told only what
you sell, the post, and the words of the voice you chose. The draft panel
starts on your first voice. Choose **No saved prompt** to draft with no
guidance at all.

## Reply voices

A voice is saved writing guidance, so every draft sounds like you. Open
**Voices** in the sidebar.

The preset voices answer the person first, then mention your product once as
something you make ("I built X for this"). They also tell the AI never to
invent facts about your product, and to mark anything it had to guess with
`[check: …]`. Edit any of that to change how your drafts behave.

Many communities remove self-promotion that does not say who wrote it. The
presets disclose that you make the product for that reason; if you remove
that line, the drafts stop saying it.

- **Start with a preset**, then change it to fit, or
- press **New voice** and write your own.

A useful voice says how you write: your tone, how long a reply should be, and
words to use or avoid. For example:

> Lead with a practical answer. Use short paragraphs and everyday language.
> Skip exclamation marks and sales jargon.

Your voices are available in every project. When you draft, choose one as
the **Writing voice** under **Voice and guidance**.

<!-- screenshot: the reply voices screen with one voice open -->

## What a draft costs

Each draft is one call to the AI model, on the **Drafting a reply** model.
A draft is written only when you press the button, never on a schedule.

::: info On SignalScout Cloud
Your plan includes a number of reply drafts each month. The **Billing**
screen shows how many are left.
:::
