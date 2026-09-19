/**
 * A verdict `capture:triage` or `live:triage-score` already bought, replayed.
 *
 * It calls nothing, so it is the baseline every candidate is read against
 * without paying for the comparison twice. Its cost is the per-item figure the
 * capture measured, passed in from the config rather than invented here, so
 * promptfoo's own cost column compares like with like.
 */
export default class RecordedTriage {
  constructor(options = {}) {
    this.label = options.config?.label ?? "recorded";
    this.perItemMicros = options.config?.perItemMicros ?? 0;
  }

  id = () => this.label;

  callApi = async (_prompt, context) => ({
    // The recorded verdict is a verdict, and the product's rule turns it into
    // a decision: only an explicit `no` drops.
    output: context.vars.recordedVerdict === "no" ? "drop" : "keep",
    cost: this.perItemMicros / 1_000_000,
    metadata: { verdict: context.vars.recordedVerdict },
  });
}
