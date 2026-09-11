---
id: BUG-018
title: An OpenAI-compatible provider is sent no schema
type: bug
priority: p1
created: 2026-09-11T19:06+08:00
parent:
area: ai
resolution:
---

## Context

**Every call to DeepSeek, OpenRouter or Ollama asked for JSON and never said
which JSON.** `createOpenAICompatible` sends `response_format: {"type":
"json_object"}` and drops the schema. It says so, in a warning nothing reads:
*The feature "responseFormat" is not supported. JSON response format schema is
only supported with structuredOutputs.* The AI SDK put the schema in the prompt
itself before version 5; version 5 moved that decision into each provider, and
the compatible one answers "no".

**The owner found it by adding a real DeepSeek key on the Models screen.** The
provider refused the call:

> Prompt must contain the word 'json' in some form to use 'response_format' of
> type 'json_object'.

That refusal is the lucky half. DeepSeek checks for the word and refuses before
reading, so nothing is billed and a person sees a sentence. A provider that does
not check answers a shape of its own, our schema refuses it, and the call is
billed and recorded as the model answering badly. That is what OpenRouter and
Ollama have been doing, and nothing in the suite noticed, because every test
that exercises a schema uses a mock model that answers correctly by
construction.

**So this is three providers, not one.** US-124 added DeepSeek and surfaced it.
The fix belongs here, in front of all three.

**The fix is what the SDK used to do.** `provider.ts` now holds one table of
which client each provider is built with, and a `compatible` client cannot
carry a schema. For those, `call.ts` adds the schema to the system prompt,
together with the literal word "json" that DeepSeek and OpenAI's `json_object`
mode both require. The answer is still validated against the Zod schema
afterwards, exactly as before. This makes the call possible; it does not make
the model obedient.

**The table is one table on purpose.** `Record<AiProvider, ClientKind>` means
the next provider added to `aiProviders` will not compile until somebody says
which client it uses, and that answer is also the answer to whether its schema
travels.

## Acceptance

- [x] A call on `deepseek`, `openrouter` or `ollama` carries the JSON schema and
      the word "json" in its prompt
- [x] A call on `openai`, `anthropic` or `google` is unchanged: no schema is
      repeated in the prompt, where the client already sends it
- [x] The caller's own system prompt survives in both cases
- [x] Adding a provider to `aiProviders` without saying which client it uses is
      a compile error
- [x] A real DeepSeek key answers the probe from the Models screen

## Notes

- The AI SDK still logs its own warning on every compatible call, because it is
  still dropping a schema we no longer rely on it to send. It is accurate and it
  is noise. Leave it until somebody counts the log lines.
- `call.test.ts` asserts what reaches the model rather than what we passed in.
  A test on our own arguments would pass with the schema still dropped.

## Log

- 2026-09-11T19:06+08:00 — Found while closing US-124's live proof. Written and
  fixed in the same sitting.
- 2026-09-11T19:20+08:00 — Fixed. `provider.ts` holds the client table and answers
  `schemaGoesInThePrompt`; `call.ts` adds the schema and the word "json" to the
  system prompt for the three compatible providers. The request body was read
  off a stubbed `fetch` before and after, so this is what goes on the wire and
  not what we passed in: before, `response_format: json_object` and two
  messages with no schema anywhere; after, the same `response_format` and the
  schema in the system message. `call.test.ts` asserts it through
  `MockLanguageModelV4`, which sees what the SDK built, and fails for all three
  providers when the flag is forced to false. The suite passes: 1,961 tests.

  Still unproven: whether DeepSeek accepts the fixed call. That is the last box
  and it needs the owner's key.
- 2026-09-11T19:24+08:00 — Proved. The owner added a real key on the Models screen and the probe
  answered. Both calls are in `model_calls` and they are the before and after of
  this bug: 11:02 UTC, no tokens, 360 ms, *Prompt must contain the word 'json'*;
  11:15 UTC, 149 input tokens, 21 output, 1,177 ms, no error. The schema in the
  prompt is what the second one carries and the first one did not. Closed.
