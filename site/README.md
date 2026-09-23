# The documentation site

The source of [docs.signalscout.run](https://docs.signalscout.run): guides for
the people who use SignalScout, in the cloud or on their own server. The rules
for people who change the code stay in [`docs/`](../docs) (US-342).

```bash
cd site
npm ci
npm run dev       # http://localhost:5173, reloads as you edit
npm run build     # fails on a dead internal link
```

This folder is outside the pnpm workspace on purpose. The image installs the
workspace, and a documentation generator has no place in it.

## A page is one Markdown file

Its path is its address: `site/self-hosting/email.md` is
`/self-hosting/email`. Add it to the sidebar in `.vitepress/config.mts`, or
nobody finds it.

**Plain Markdown only.** No Vue component inside a page. A page is read as
text by agents, through the repository and through `llms.txt`, and a
component is a hole in that text.

## Mix text, pictures and diagrams

A page of text alone is tiring to read. Use a picture where it is clearer
than a sentence:

- **A screenshot** shows where a thing is on a screen. It is taken by the
  screenshot script from a local instance filled with invented sample data.
  Never a real person's post or handle. Store it beside the page, and write
  alt text that says what it shows.
- **A diagram** shows an order or a relation: what happens to a post, which
  setting changes what. Write it as a ` ```mermaid ` block. It stays text,
  so the next change to the code can change the diagram in the same commit.
- **A hero picture** that rarely changes may be drawn in Excalidraw. Commit
  the `.excalidraw` source beside the exported SVG.

## Voice

Write to one person, who wants to get something done:

- Short sentences, active voice, one idea per sentence.
- Say what to do, then why. The why is one sentence, not a history.
- Name a screen and a button exactly as the application does.
- No idioms and no metaphors. Many readers are not native English speakers.

## What does not go here

- A price, a credit count or a plan limit. The pricing page owns them.
- How the code works or why it is built this way. That is `docs/`, for
  contributors.
