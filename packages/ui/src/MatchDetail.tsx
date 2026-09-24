import { type ReactNode, useState } from "react";
import { BrandIcon } from "./BrandIcon.js";
import { ageLabel } from "./labels.js";
import {
  limitWords,
  type Match,
  opensThreadOnly,
  platformLabel,
  threadDepth,
  type Verdict,
  whereItCameFrom,
} from "./match.js";
import { ReplyDraft } from "./ReplyDraft.js";

/**
 * The reading pane: one match, what the model saw in it, and what a person
 * does next. US-352.
 *
 * The page owns the requests. Saving and judging are callbacks, and `saving`
 * and `judging` are the page's answer to "is one in flight", so a failed
 * request leaves the pane as it was. The only state here is whether the post
 * is shown in full; a page renders the pane with `key={match.id}`, so moving
 * to another match folds it again.
 *
 * `actions` is where a product adds its own buttons beside the conversation
 * link: self-hosted it is *Copy link*.
 */
export interface MatchDetailProps {
  readonly match: Match;
  readonly saving: boolean;
  readonly judging: boolean;
  readonly onSave: (saved: boolean) => void;
  readonly onJudge: (verdict: Verdict) => void;
  /** Closes the pane on a phone, where it covers the list. */
  readonly onBack: () => void;
  readonly actions?: ReactNode;
  /**
   * Mark the match replied, or take the mark back. US-396.
   *
   * Optional, and the button and the question after *Copy* show only when it
   * is given: a page that does not store the mark must not offer it.
   */
  readonly onReplied?: (replied: boolean) => void;
  /** A replied request is in flight. */
  readonly marking?: boolean;
}

export function MatchDetail({
  match,
  saving,
  judging,
  onSave,
  onJudge,
  onBack,
  actions,
  onReplied,
  marking = false,
}: MatchDetailProps) {
  const replied = match.replied === true;
  const [expanded, setExpanded] = useState(false);
  const post = limitWords(match.excerpt);
  const depth = threadDepth(match);
  const threadOnly = opensThreadOnly(match);
  const scores: Array<[string, number]> = [
    ["Problem fit", match.problemFit],
    ["ICP fit", match.icpFit],
    ["Intent", match.intent],
  ];

  return (
    <div className="detail-inner">
      <button className="mobile-detail-back" type="button" onClick={onBack}>
        ← Back to inbox
      </button>

      <div className="detail-top">
        <span className={`source-badge source-${match.source}`}>
          <BrandIcon brand={match.source} />
          {whereItCameFrom(match)}
        </span>
        <span className="match-origin">{ageLabel(match.postedAt)}</span>
      </div>

      <h2 className="detail-title">
        {match.title ?? match.parentTitle ?? "A conversation worth reading"}
      </h2>
      <p className="detail-author">
        {match.author ?? "Unknown author"} · matched by {match.monitorName}
      </p>

      {/* The thread above a reply, first: a reply is a good lead or noise
          depending on the post it answers, and the classifier saw both. */}
      {match.kind === "reply" && match.parentExcerpt && (
        <div className="post-body">
          <p className="section-label">Replying to</p>
          <blockquote className="post-box thread-post">
            {match.parentTitle && (
              <strong className="thread-post-title">{match.parentTitle}</strong>
            )}
            {limitWords(match.parentExcerpt).text}
          </blockquote>
          {depth && <p className="thread-depth">{depth}</p>}
        </div>
      )}

      <div className="post-body">
        {match.kind === "reply" && <p className="section-label">The reply</p>}
        <blockquote className="post-box">{expanded ? match.excerpt : post.text}</blockquote>
        {post.truncated && (
          <button className="read-more-button" type="button" onClick={() => setExpanded(!expanded)}>
            {expanded ? "Show less" : "Read more"}
          </button>
        )}
      </div>

      {/* Open, under the post: they explain the number the list was ordered
          by, and behind a disclosure they were a click nobody made. */}
      <section className="score-section">
        <div className="score-heading">
          <h3>Score breakdown</h3>
          <span>{match.score} / 100</span>
        </div>

        <dl className="match-scores">
          {scores.map(([label, score]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{score}</dd>
              <span className="score-bar" aria-hidden="true">
                <i style={{ width: `${score}%` }} />
              </span>
            </div>
          ))}
        </dl>
      </section>

      {/* Said before the link is pressed: some platforms have no address for
          a single comment, so the link opens the post and the handle is what
          makes the scrolling shorter (US-047). */}
      {threadOnly && (
        <p className="link-caveat">
          {platformLabel(match.source).name} has no link to a single comment. This opens the post —
          open the comments and look for{" "}
          <strong>{match.author ? `@${match.author}` : "the author"}</strong>.
        </p>
      )}

      <div className="match-actions">
        <a className="primary-button" href={match.url} rel="noreferrer noopener" target="_blank">
          {threadOnly ? "Open the post ↗" : "Open conversation ↗"}
        </a>
        {actions}
        <button
          aria-pressed={match.saved}
          className={match.saved ? "secondary-button chosen" : "secondary-button"}
          disabled={saving}
          type="button"
          onClick={() => onSave(!match.saved)}
        >
          {match.saved ? "Saved" : "Save for later"}
        </button>
        {onReplied && (
          <button
            aria-pressed={replied}
            className={replied ? "secondary-button chosen" : "secondary-button"}
            disabled={marking}
            type="button"
            onClick={() => onReplied(!replied)}
          >
            {replied ? "Replied" : "Mark as replied"}
          </button>
        )}
        <span className="match-meta">{match.intentLabel}</span>
      </div>

      <div className="match-why">
        <p className="section-label">What the model saw</p>
        <ul>
          {match.reasons.map((reason) => (
            <li key={reason}>
              <span aria-hidden="true">•</span>
              {reason}
            </li>
          ))}
        </ul>
      </div>

      <ReplyDraft
        key={match.id}
        matchId={match.id}
        replied={replied}
        marking={marking}
        onReplied={onReplied}
      />

      <div className="verdict-actions">
        <p className="section-label">Was this a good lead?</p>
        <div className="verdict-buttons">
          <button
            aria-pressed={match.verdict === "good"}
            className={match.verdict === "good" ? "verdict-button chosen" : "verdict-button"}
            disabled={judging}
            type="button"
            onClick={() => onJudge("good")}
          >
            Good lead
          </button>
          <button
            aria-pressed={match.verdict === "not_relevant"}
            className={
              match.verdict === "not_relevant" ? "verdict-button chosen" : "verdict-button"
            }
            disabled={judging}
            type="button"
            onClick={() => onJudge("not_relevant")}
          >
            Not relevant
          </button>
        </div>
        <p className="verdict-note">
          Dismissed a conversation? Bring it back with Filters → Not relevant → Shown.
        </p>
      </div>
    </div>
  );
}
