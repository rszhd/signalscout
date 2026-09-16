/**
 * A `fetch` that cannot reach anything.
 *
 * docs/testing.md: a test that would spend money must fail loudly, not spend
 * it. Passing this into a connector's runtime makes the real network
 * unreachable rather than merely unused, so "no network call" is an assertion
 * and not a claim about the code we happened to write.
 */
export const unreachableFetch: typeof globalThis.fetch = (input) => {
  const target =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : (input as { url: string }).url;
  return Promise.reject(
    new Error(
      `A test tried to fetch ${target}. No test reaches Reddit, X or a model provider. ` +
        "See docs/testing.md.",
    ),
  );
};
