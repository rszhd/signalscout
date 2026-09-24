import { useState } from "react";
import { activeFilters, type InboxOrder, inboxOrders, scoreFilters } from "./match.js";

/**
 * The inbox's frame around the list: the filter bar, the banner that says new
 * matches arrived, the list's heading and *Show more*. US-370.
 *
 * The page holds every value and every request; these show them and call
 * back. The only state here is whether the Filters panel is open.
 */

export interface InboxFiltersProps {
  /** The Saved view rather than the inbox. */
  readonly saved: boolean;
  readonly onSaved: (saved: boolean) => void;
  /**
   * The Replied view: what the person answered, newest reply first. US-399.
   * Optional as a pair: without it the switch has two views, as before.
   */
  readonly repliedView?: boolean;
  readonly onRepliedView?: (replied: boolean) => void;
  readonly monitors: readonly { readonly id: string; readonly name: string }[];
  readonly monitorId: string;
  readonly onMonitor: (monitorId: string) => void;
  readonly order: InboxOrder;
  readonly onOrder: (order: InboxOrder) => void;
  readonly minScore: number;
  readonly onMinScore: (minScore: number) => void;
  readonly showDismissed: boolean;
  readonly onShowDismissed: (show: boolean) => void;
  /**
   * Replied matches left out. US-396. Optional as a pair: a page that does not
   * store the mark gets no filter for it.
   */
  readonly hideReplied?: boolean;
  readonly onHideReplied?: (hide: boolean) => void;
  readonly onClear: () => void;
}

/**
 * The Inbox/Saved/Replied switch, the monitor picker, the order and the
 * Filters panel. The picker shows only when a project has more than one monitor: a
 * choice of one narrows nothing. The order is hidden in the Saved and Replied
 * views, which have orders of their own.
 */
export function InboxFilters({
  saved,
  onSaved,
  repliedView = false,
  onRepliedView,
  monitors,
  monitorId,
  onMonitor,
  order,
  onOrder,
  minScore,
  onMinScore,
  showDismissed,
  onShowDismissed,
  hideReplied = false,
  onHideReplied,
  onClear,
}: InboxFiltersProps) {
  const [open, setOpen] = useState(false);
  const count = activeFilters({
    monitors,
    monitorId,
    minScore,
    showDismissed,
    // Not offered on the Replied view, so not counted there either.
    hideReplied: hideReplied && !repliedView,
  });

  return (
    <>
      <div className="inbox-toolbar">
        <fieldset className="view-switch inbox-views" aria-label="Which matches">
          {/* The views are exclusive: each button turns the others off. */}
          <button
            type="button"
            aria-pressed={!saved && !repliedView}
            onClick={() => {
              onRepliedView?.(false);
              onSaved(false);
            }}
          >
            Inbox
          </button>
          <button
            type="button"
            aria-pressed={saved}
            onClick={() => {
              onRepliedView?.(false);
              onSaved(true);
            }}
          >
            Saved
          </button>
          {onRepliedView && (
            <button
              type="button"
              aria-pressed={repliedView}
              onClick={() => {
                onSaved(false);
                onRepliedView(true);
              }}
            >
              Replied
            </button>
          )}
        </fieldset>
        <div className="inbox-filters">
          {monitors.length > 1 && (
            <label className="filter">
              <span>Monitor</span>
              <select
                aria-label="Monitor"
                value={monitorId}
                onChange={(event) => onMonitor(event.target.value)}
              >
                <option value="">All monitors</option>
                {monitors.map((monitor) => (
                  <option key={monitor.id} value={monitor.id}>
                    {monitor.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {!saved && !repliedView && (
            <label className="filter">
              <span>Order</span>
              <select
                aria-label="Order"
                value={order}
                onChange={(event) => onOrder(event.target.value as InboxOrder)}
              >
                {inboxOrders.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}

          <button
            className={
              count > 0 ? "compact-button filter-toggle active" : "compact-button filter-toggle"
            }
            type="button"
            aria-expanded={open}
            aria-controls="inbox-extra-filters"
            onClick={() => setOpen(!open)}
          >
            Filters{count > 0 ? ` · ${count}` : ""}
          </button>
        </div>
      </div>
      <div className="inbox-extra-filters" id="inbox-extra-filters" hidden={!open}>
        <label className="filter">
          <span>Minimum score</span>
          <select
            aria-label="Minimum score"
            value={String(minScore)}
            onChange={(event) => onMinScore(Number(event.target.value))}
          >
            {scoreFilters.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <label className="filter">
          <span>Not relevant</span>
          <select
            aria-label="Not relevant"
            value={showDismissed ? "show" : "hide"}
            onChange={(event) => onShowDismissed(event.target.value === "show")}
          >
            <option value="hide">Hidden</option>
            <option value="show">Shown</option>
          </select>
        </label>

        {/* Hiding replied matches would empty the Replied view. */}
        {onHideReplied && !repliedView && (
          <label className="filter">
            <span>Replied</span>
            <select
              aria-label="Replied"
              value={hideReplied ? "hide" : "show"}
              onChange={(event) => onHideReplied(event.target.value === "hide")}
            >
              <option value="show">Shown</option>
              <option value="hide">Hidden</option>
            </select>
          </label>
        )}

        {count > 0 && (
          <button className="read-more-button" type="button" onClick={onClear}>
            Clear filters
          </button>
        )}
      </div>
    </>
  );
}

/**
 * How many matches arrived since the list was read, as the one thing that
 * reloads it; the list never moves while somebody reads it. A live region
 * present and empty rather than one that appears with its words: a region
 * added with its content is announced by nothing.
 */
export function ArrivedBanner({
  arrived,
  onShow,
}: {
  /** Zero, or while the list loads, shows nothing. */
  readonly arrived: number;
  readonly onShow: () => void;
}) {
  return (
    <div className="inbox-arrived-slot" role="status" aria-live="polite">
      {arrived > 0 && (
        <button className="inbox-arrived" type="button" onClick={onShow}>
          {arrived === 1 ? "Show 1 new match" : `Show ${arrived} new matches`}
        </button>
      )}
    </div>
  );
}

/**
 * The line above the list: how many, in what order, and the export beside
 * the count, since the count is what it exports. A plain link, so the browser
 * downloads it and the server names the file.
 */
export function MatchListHeading({
  count,
  more,
  heading,
  exportHref,
}: {
  readonly count: number;
  /** More pages exist: the count is a floor. */
  readonly more: boolean;
  readonly heading: string;
  readonly exportHref: string;
}) {
  return (
    <div className="list-heading">
      <span>
        {count}
        {more ? "+" : ""} conversations
      </span>
      <span>{heading}</span>
      <a className="inbox-export" href={exportHref} download>
        Export CSV
      </a>
    </div>
  );
}

export function ShowMore({
  loading,
  onClick,
}: {
  readonly loading: boolean;
  readonly onClick: () => void;
}) {
  return (
    <div className="inbox-more">
      <button className="secondary-button" disabled={loading} type="button" onClick={onClick}>
        {loading ? "Loading…" : "Show more"}
      </button>
    </div>
  );
}
