/**
 * The pre-filter's first stage: does this post mention what the monitor is
 * about, or come from a place the monitor named?
 *
 * It is free, it runs before anything is embedded, and it is deliberately
 * crude. The rule is one sentence: **a post is kept unless it matches nothing
 * at all.** One word in common is enough, and a post from a named subreddit is
 * kept whatever it says, because the person named that subreddit as a place
 * their customers post.
 *
 * Crude on purpose. US-008's risk is not a model bill; it is a good lead that
 * is dropped where nobody can see it. A stage that demanded two words, or a
 * phrase, would be the same stage with a silent false-negative rate nobody
 * measured. This one drops the post that shares no word with anything the
 * monitor is looking for, which is the failure a person would agree with by
 * reading the post.
 *
 * The words come from the monitor's own search queries, which is what the
 * source was asked for. That is not circular: a provider's keyword search
 * decides for itself what a phrase matches, and the live run behind US-014
 * showed it returning posts that matched loosely. This is our half of the same
 * question, asked over the text we actually stored.
 */

/** What the stage reads. A row, narrowed: no ids, no embedding, no dates. */
export interface FilterablePost {
  /** The subreddit on Reddit. Null on X, where there is no channel. */
  readonly channel?: string | null;
  readonly title?: string | null;
  readonly excerpt: string;
}

/** What the monitor is looking for, as the stage compares it. */
export interface KeywordRule {
  /** Every distinct word worth matching, lower case. */
  readonly keywords: ReadonlySet<string>;
  /** Every named channel, lower case, with no `r/` prefix. */
  readonly channels: ReadonlySet<string>;
}

/**
 * Words that appear in almost every query and match almost every post.
 *
 * Short and closed on purpose. This is not a linguistics problem: it is the
 * handful of words that would make the rule above match everything and so mean
 * nothing. A longer list is a longer list of decisions nobody reviewed.
 */
const stopWords = new Set([
  "a",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "best",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "get",
  "good",
  "has",
  "have",
  "how",
  "i",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "need",
  "not",
  "of",
  "on",
  "or",
  "our",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "they",
  "this",
  "to",
  "up",
  "use",
  "want",
  "was",
  "we",
  "what",
  "when",
  "which",
  "why",
  "with",
  "you",
  "your",
]);

/** Shorter than this and a word matches more by accident than by meaning. */
const shortestKeyword = 3;

/**
 * One written form for a word, so "test" and "tests" are the same keyword.
 *
 * A trailing `s` only, and only on a word long enough for it to be a plural.
 * Not a stemmer: a stemmer is a dependency and a set of surprises, and this
 * stage is allowed to be approximate in the permissive direction.
 */
function fold(word: string): string {
  return word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word;
}

/** The words of a piece of text, lower case, punctuation dropped. */
function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/**
 * The rule for one monitor.
 *
 * An empty rule — no queries and no subreddits — keeps every post. A monitor
 * with nothing to match on is a monitor whose posts arrived some other way,
 * and a stage that dropped all of them would be a silent stop with no reason
 * a person could read.
 */
export function keywordRuleFor(monitor: {
  readonly queries: readonly string[];
  readonly subreddits: readonly string[];
}): KeywordRule {
  const keywords = new Set<string>();

  for (const query of monitor.queries) {
    for (const word of wordsOf(query)) {
      if (word.length < shortestKeyword) continue;
      if (stopWords.has(word)) continue;
      keywords.add(fold(word));
    }
  }

  return {
    keywords,
    channels: new Set(monitor.subreddits.map((name) => name.toLowerCase())),
  };
}

/** True when this monitor has nothing to match on, and so drops nothing here. */
export function ruleIsEmpty(rule: KeywordRule): boolean {
  return rule.keywords.size === 0 && rule.channels.size === 0;
}

export function keepsPost(rule: KeywordRule, post: FilterablePost): boolean {
  if (ruleIsEmpty(rule)) return true;

  const channel = post.channel?.toLowerCase().replace(/^\/?r\//, "");
  if (channel && rule.channels.has(channel)) return true;

  if (rule.keywords.size === 0) return false;

  for (const word of wordsOf(`${post.title ?? ""} ${post.excerpt}`)) {
    if (rule.keywords.has(fold(word))) return true;
  }

  return false;
}
