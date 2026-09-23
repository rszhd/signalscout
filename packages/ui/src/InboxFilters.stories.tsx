import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { fn } from "storybook/test";
import { ArrivedBanner, InboxFilters, MatchListHeading, ShowMore } from "./InboxFilters.js";
import { MatchCard } from "./MatchCard.js";
import { type InboxOrder, inboxOrders } from "./match.js";
import { match } from "./testing/matches.js";

const monitors = [
  { id: "m1", name: "Reddit weekly" },
  { id: "m2", name: "X daily" },
];

/** The bar with state behind it, the way an inbox holds it. */
function Bar({
  monitorCount = 2,
  startFiltered = false,
}: {
  readonly monitorCount?: number;
  readonly startFiltered?: boolean;
}) {
  const [saved, setSaved] = useState(false);
  const [monitorId, setMonitorId] = useState(startFiltered ? "m1" : "");
  const [order, setOrder] = useState<InboxOrder>("rank");
  const [minScore, setMinScore] = useState(startFiltered ? 70 : 0);
  const [showDismissed, setShowDismissed] = useState(false);

  return (
    <InboxFilters
      saved={saved}
      onSaved={setSaved}
      monitors={monitors.slice(0, monitorCount)}
      monitorId={monitorId}
      onMonitor={setMonitorId}
      order={order}
      onOrder={setOrder}
      minScore={minScore}
      onMinScore={setMinScore}
      showDismissed={showDismissed}
      onShowDismissed={setShowDismissed}
      onClear={() => {
        setMonitorId("");
        setMinScore(0);
        setShowDismissed(false);
      }}
    />
  );
}

const meta = {
  title: "Components/InboxFilters",
  component: Bar,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Bar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Several monitors: the picker is there. */
export const SeveralMonitors: Story = {};

/** One monitor, as the hosted product always has: a choice of one is hidden. */
export const OneMonitor: Story = { args: { monitorCount: 1 } };

export const Filtered: Story = { args: { startFiltered: true } };

/** The frame around the list: the bar, the arrival banner, the heading and Show more. */
export const InboxFrame: Story = {
  render: () => (
    <div style={{ maxWidth: 520 }}>
      <Bar />
      <ArrivedBanner arrived={3} onShow={fn()} />
      <MatchListHeading
        count={40}
        more
        heading={inboxOrders[0].heading}
        exportHref="/api/matches/export?projectId=p1"
      />
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        <li>
          <MatchCard match={match()} selected onSelect={fn()} />
        </li>
        <li>
          <MatchCard match={match({ id: "match-2", score: 62 })} selected={false} onSelect={fn()} />
        </li>
      </ol>
      <ShowMore loading={false} onClick={fn()} />
    </div>
  ),
};
