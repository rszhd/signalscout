/**
 * The two pieces of text the embedding stage compares.
 *
 * Both are built here, and both matter more than they look.
 *
 * **The monitor's text is also its cache key.** `monitors.description_embedding_source`
 * holds the exact string that produced the stored vector, and the stage
 * re-embeds when what this function returns differs from it. So a change to
 * the wording below re-embeds every monitor once, which costs a fraction of a
 * cent and is the correct answer: an old vector of new answers is a filter
 * quietly matching the wrong thing.
 *
 * **The signals are not in it.** A signal is a kind of post the person wants,
 * not a description of their market, and the classifier already reads them.
 * Putting them here would re-embed every monitor whenever somebody ticked a
 * box, and would move every similarity by an amount nobody could explain.
 */

/** The three answers that describe what the monitor is about. */
export interface MonitorDescription {
  readonly product: string;
  readonly idealCustomer: string;
  readonly problem: string;
}

export function monitorDescriptionText(monitor: MonitorDescription): string {
  return [
    `Product: ${monitor.product}`,
    `Ideal customer: ${monitor.idealCustomer}`,
    `Problem it solves: ${monitor.problem}`,
  ].join("\n");
}

/** A post, as the embedding stage reads it. */
export interface EmbeddablePost {
  readonly title?: string | null;
  readonly excerpt: string;
}

/**
 * The post's own text: its title and the excerpt we stored.
 *
 * Only the excerpt, because only the excerpt is kept — Reddit's terms are why,
 * and STACK.md, *Honor deletions*, is where that decision lives. The similarity
 * is therefore a measure over what we hold, not over the whole post.
 */
export function postEmbeddingText(post: EmbeddablePost): string {
  return [post.title?.trim(), post.excerpt.trim()].filter(Boolean).join("\n\n");
}
