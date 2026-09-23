import { BrandIcon } from "./BrandIcon.js";
import { ageLabel } from "./labels.js";
import { type Match, whereItCameFrom } from "./match.js";
import { band } from "./monitor.js";

/**
 * One row of the inbox list. US-352.
 *
 * A button, because pressing it selects the match for the reading pane; the
 * page wraps it in the list item and decides what selecting does — which pane
 * opens, and what the address becomes. It holds no state.
 */
export interface MatchCardProps {
  readonly match: Match;
  readonly selected: boolean;
  readonly onSelect: () => void;
}

export function MatchCard({ match, selected, onSelect }: MatchCardProps) {
  const tone = band(match.score);
  const heading = match.title ?? match.parentTitle;

  return (
    <button
      className={selected ? "match-card selected" : "match-card"}
      aria-current={selected ? "true" : undefined}
      type="button"
      onClick={onSelect}
    >
      <span className="match-top">
        <span className={`source-badge source-${match.source}`}>
          <BrandIcon brand={match.source} />
          {whereItCameFrom(match)}
        </span>
        <span className="match-origin">{ageLabel(match.postedAt)}</span>
      </span>
      <strong className="match-title">
        {match.kind === "reply" && (
          <span className="match-kind">
            <span className="visually-hidden">A reply: </span>
            <span aria-hidden="true">↳ </span>
          </span>
        )}
        {heading ?? match.excerpt}
      </strong>
      {heading && <span className="match-excerpt">{match.excerpt}</span>}
      <span className="match-bottom">
        <span className={`intent-pill ${tone.tone}`}>{tone.label}</span>
        <span className="match-list-status">
          {match.saved ? "Saved" : match.verdict === "good" ? "Good lead" : ""}
        </span>
        <span className="match-score">
          <strong>{match.score}</strong>
          <span>/ 100</span>
        </span>
      </span>
    </button>
  );
}
