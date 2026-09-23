/**
 * The API a story talks to, instead of a server. US-351.
 *
 * `ReplyDraft` and `ReplyVoices` fetch on mount. A story names the answers in
 * `parameters.api`, keyed by method and path, and `preview.tsx` puts this
 * function in place of `fetch` before the story renders:
 *
 *     parameters: {
 *       api: {
 *         "GET /api/reply-prompts": { body: { prompts: [] } },
 *         "POST /api/matches/*\/draft": { status: 402, body: { message: "…" } },
 *       },
 *     }
 *
 * `*` matches one path segment. A call nothing names answers 404 and warns in
 * the console, so a story that forgot a route says so rather than showing a
 * screen stuck in its loading state for no visible reason.
 */

export interface ApiAnswer {
  readonly status?: number;
  readonly body?: unknown;
  /** Milliseconds before the answer, or `"never"` to hold a loading state. */
  readonly delay?: number | "never";
}

export type ApiRoutes = Readonly<
  Record<string, ApiAnswer | ((request: { url: string; body: unknown }) => ApiAnswer)>
>;

function matches(pattern: string, method: string, path: string): boolean {
  const [wantedMethod, wantedPath = ""] = pattern.split(" ");
  if (wantedMethod !== method) return false;

  const wanted = wantedPath.split("/");
  const actual = path.split("/");
  return (
    wanted.length === actual.length &&
    wanted.every((segment, index) => segment === "*" || segment === actual[index])
  );
}

export function fakeFetch(routes: ApiRoutes): typeof fetch {
  return async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? "GET";
    const path = new URL(url, globalThis.location.href).pathname;
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

    const key = Object.keys(routes).find((pattern) => matches(pattern, method, path));
    const route = key === undefined ? undefined : routes[key];
    if (route === undefined) {
      console.warn(`[stories] no answer for ${method} ${path}; add it to parameters.api`);
      return Response.json({ message: `No story answer for ${method} ${path}.` }, { status: 404 });
    }

    const answer = typeof route === "function" ? route({ url, body }) : route;
    if (answer.delay === "never") return new Promise<Response>(() => {});
    if (answer.delay) await new Promise((resolve) => setTimeout(resolve, answer.delay as number));

    const status = answer.status ?? 200;
    return status === 204 ? new Response(null, { status }) : Response.json(answer.body, { status });
  };
}
