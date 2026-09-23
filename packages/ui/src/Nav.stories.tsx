import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { BrandLogo } from "./BrandLogo.js";
import { AccountIdentity, NavItem, SignOut } from "./Nav.js";

/**
 * The navigation's parts, and one sidebar per product built from them. The
 * two sidebars are examples, not components: each application writes its own,
 * because what they hold differs.
 */
const meta = {
  title: "Components/Navigation",
  component: NavItem,
  args: { icon: "inbox", label: "Inbox", to: "/projects/p1" },
} satisfies Meta<typeof NavItem>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Item: Story = {
  decorators: [
    (Story) => (
      <nav className="site-nav" style={{ width: 216 }}>
        <Story />
      </nav>
    ),
  ],
};

export const CurrentItem: Story = {
  args: { current: true },
  decorators: Item.decorators,
};

export const Identity: Story = {
  render: () => (
    <div style={{ width: 280 }}>
      <AccountIdentity name="Alex Morgan" email="alex.morgan@example.com" />
    </div>
  ),
};

function Frame({
  children,
  bottom,
}: {
  readonly children: React.ReactNode;
  readonly bottom: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/projects" aria-label="SignalScout home">
          <BrandLogo />
          <span>SignalScout</span>
        </a>
        <nav className="site-nav" aria-label="Screens">
          {children}
        </nav>
        <div className="sidebar-bottom">{bottom}</div>
      </aside>
    </div>
  );
}

/** Self-hosted: the current project's screens sit under Projects. */
export const SelfHostedSidebar: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <Frame
      bottom={
        <>
          <nav className="account-nav" aria-label="Account">
            <p className="sidebar-section-label">Account</p>
            <NavItem icon="providers" label="Providers" to="/providers" />
            <NavItem icon="voices" label="Voices" to="/reply-voices" />
            <NavItem icon="models" label="Models" to="/models" />
          </nav>
          <AccountIdentity name="Alex Morgan" email="alex.morgan@example.com" />
          <SignOut />
        </>
      }
    >
      <NavItem icon="projects" label="Projects" to="/projects" />
      <NavItem icon="inbox" label="Inbox" to="/projects/p1" current />
      <NavItem icon="monitors" label="Monitors" to="/projects/p1/monitors" />
      <NavItem className="account-sheet-button" icon="account" label="Account" onClick={fn()} />
    </Frame>
  ),
};

/** Hosted: Voices and Billing under the account; the project list is the application's own. */
export const HostedSidebar: Story = {
  parameters: { layout: "fullscreen" },
  render: () => (
    <Frame
      bottom={
        <>
          <nav className="account-nav" aria-label="Account">
            <p className="sidebar-section-label">Account</p>
            <NavItem icon="voices" label="Voices" to="/reply-voices" />
            <NavItem icon="billing" label="Billing" to="/billing" current />
          </nav>
          <AccountIdentity name="Alex Morgan" email="alex.morgan@example.com" />
          <SignOut />
        </>
      }
    >
      <NavItem icon="projects" label="Projects" to="/projects" />
      <NavItem className="account-sheet-button" icon="account" label="Account" onClick={fn()} />
    </Frame>
  ),
};
