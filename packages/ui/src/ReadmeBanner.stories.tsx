import type { Meta, StoryObj } from "@storybook/react-vite";
import type { CSSProperties } from "react";
import { fn } from "storybook/test";
import { BrandLogo } from "./BrandLogo.js";
import { MatchCard } from "./MatchCard.js";
import { MatchDetail } from "./MatchDetail.js";
import { match } from "./testing/matches.js";

/**
 * The banner at the top of the repository's README, built from the package's
 * own components and tokens so it cannot drift from the product's look.
 * `node scripts/readme-banner.mjs` saves it as `docs/img/banner.png`.
 *
 * Every match here is invented. A screenshot of a real inbox shows a real
 * person's post and handle, which is the reason `docs/img/inbox.jpg` is due to
 * be replaced (US-343).
 */

const width = 1280;
const height = 400;

const open = match({ id: "a" });

const matches = [
  open,
  match({
    id: "b",
    score: 88,
    source: "x",
    channel: null,
    author: "maria_builds",
    title: null,
    excerpt: "Is there a tool that tells me which of our tests fail without a code change?",
    postedAt: new Date(Date.now() - 41 * 60_000).toISOString(),
  }),
  match({
    id: "c",
    score: 76,
    kind: "reply",
    title: null,
    channel: "QualityAssurance",
    author: "devon_ships",
    parentTitle: "What do you use for flaky end-to-end tests?",
    excerpt: "We hit this too. Retries hid it for months until a release went out broken.",
    postedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  }),
];

const canvas: CSSProperties = {
  position: "relative",
  width,
  height,
  overflow: "hidden",
  background: "var(--surface-soft)",
  // The mark's lattice, faint, behind everything: one found signal among dots.
  backgroundImage:
    "radial-gradient(circle, color-mix(in srgb, var(--accent-tint) 30%, transparent) 1.5px, transparent 1.6px)",
  backgroundSize: "22px 22px",
};

const glow: CSSProperties = {
  position: "absolute",
  left: -200,
  bottom: -300,
  width: 900,
  height: 640,
  borderRadius: "50%",
  background:
    "radial-gradient(closest-side, color-mix(in srgb, var(--accent-tint) 55%, transparent), transparent)",
};

const copy: CSSProperties = {
  position: "absolute",
  left: 64,
  top: 0,
  bottom: 0,
  width: 500,
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 24,
};

// The product at 65%, so the list, the score and its reasons all fit. `zoom`
// scales the offsets too, so each is divided by it.
const scale = 0.65;
const appFrame: CSSProperties = {
  position: "absolute",
  left: 600 / scale,
  top: 52 / scale,
  width: 1160,
  height: 600,
  zoom: scale,
  display: "grid",
  gridTemplateColumns: "380px 1fr",
  overflow: "hidden",
  background: "var(--surface)",
  border: "1px solid var(--line-dark)",
  borderRadius: "var(--radius-lg) 0 0 0",
  boxShadow: "var(--shadow-card)",
};

function Banner() {
  return (
    <div style={canvas}>
      <div style={glow} />
      <div style={copy}>
        <div className="brand" style={{ padding: 0, fontSize: 28, fontWeight: 600 }}>
          <BrandLogo size={44} />
          <span>SignalScout</span>
        </div>
        <h1
          style={{
            margin: 0,
            color: "var(--ink)",
            fontSize: 46,
            fontWeight: 600,
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
          }}
        >
          The useful conversation is hiding in the noise.
        </h1>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 20 }}>
          AI intent monitoring you can self-host.
        </p>
      </div>
      <div style={appFrame}>
        <ol
          aria-label="Matches"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 12,
            borderRight: "1px solid var(--line)",
            display: "grid",
            alignContent: "start",
            gap: 8,
          }}
        >
          {matches.map((item, index) => (
            <li key={item.id}>
              <MatchCard match={item} selected={index === 0} onSelect={fn()} />
            </li>
          ))}
        </ol>
        <div style={{ overflow: "hidden" }}>
          <MatchDetail
            match={open}
            saving={false}
            judging={false}
            onSave={fn()}
            onJudge={fn()}
            onBack={fn()}
          />
        </div>
      </div>
    </div>
  );
}

const meta = {
  title: "Brand/README banner",
  component: Banner,
  parameters: {
    layout: "fullscreen",
    api: { "GET /api/reply-prompts": { body: { prompts: [] } } },
  },
} satisfies Meta<typeof Banner>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
