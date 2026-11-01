/**
 * The documentation site, served at docs.signalscout.run. US-342.
 *
 * A page is one Markdown file under `site/`, and its path is its address:
 * `site/getting-started/index.md` is `/getting-started/`. `site/README.md` says
 * how to write one.
 *
 * Two plugins, and each is why a rule in the README holds:
 *
 * - `llmstxt` writes `llms.txt` and `llms-full.txt`, so an agent reading the
 *   live site gets the Markdown rather than the rendered page.
 * - `withMermaid` draws a ```mermaid block as a diagram, so a diagram stays
 *   text in the page an agent can read and update beside the code.
 *
 * A dead internal link fails the build, which is VitePress's default and the
 * reason nothing here turns it off.
 *
 * The self-hosting guide is hidden: no menu, home page or other page links to
 * it, and search and `llms.txt` leave it out. Its pages stay at their
 * addresses, because the repository's README and SECURITY.md link to them,
 * and they keep their own sidebar for a reader who arrives that way.
 */
import { defineConfig } from "vitepress";
import llmstxt from "vitepress-plugin-llms";
import { withMermaid } from "vitepress-plugin-mermaid";

export default withMermaid(
  defineConfig({
    title: "SignalScout Docs",
    description:
      "Find the people publicly describing the problem your product solves. Guides for SignalScout Cloud.",
    lang: "en",
    cleanUrls: true,
    lastUpdated: true,
    // The README is for people writing pages, not a page.
    srcExclude: ["README.md"],
    // A link to localhost is an instruction to the reader, not a page on this
    // site. Every other dead link still fails the build.
    ignoreDeadLinks: "localhostLinks",

    head: [
      ["link", { rel: "icon", type: "image/svg+xml", href: "/brand/mark-small.svg" }],
      ["meta", { name: "theme-color", content: "#0b57d0" }],
    ],

    themeConfig: {
      logo: { src: "/brand/mark.svg", alt: "" },
      siteTitle: "SignalScout Docs",

      nav: [
        { text: "Getting started", link: "/getting-started/" },
        { text: "Cloud", link: "/cloud/" },
      ],

      sidebar: {
        "/self-hosting/": [
          {
            text: "Self-hosting",
            items: [
              { text: "Overview", link: "/self-hosting/" },
              { text: "Install", link: "/self-hosting/install" },
              { text: "Providers and keys", link: "/self-hosting/keys" },
              { text: "AI models", link: "/self-hosting/models" },
              { text: "Accounts and sign-up", link: "/self-hosting/accounts" },
              { text: "HTTPS and the proxy", link: "/self-hosting/https" },
              { text: "Email", link: "/self-hosting/email" },
              { text: "Webhooks", link: "/self-hosting/webhooks" },
              { text: "What it costs you", link: "/self-hosting/costs" },
              { text: "Back up and upgrade", link: "/self-hosting/maintenance" },
              { text: "Troubleshooting", link: "/self-hosting/troubleshooting" },
              { text: "Configuration reference", link: "/self-hosting/configuration" },
            ],
          },
        ],
        "/": [
          {
            text: "Getting started",
            items: [
              { text: "What SignalScout does", link: "/getting-started/" },
              { text: "Your first match", link: "/getting-started/first-match" },
            ],
          },
          {
            text: "Using SignalScout",
            items: [
              { text: "Projects", link: "/using/projects" },
              { text: "Monitors", link: "/using/monitors" },
              { text: "The inbox", link: "/using/inbox" },
              { text: "Reply drafts", link: "/using/replies" },
              { text: "Notifications", link: "/using/notifications" },
              { text: "Webhooks", link: "/using/webhooks" },
            ],
          },
          {
            text: "SignalScout Cloud",
            items: [
              { text: "What the plan covers", link: "/cloud/" },
              { text: "Plans and billing", link: "/cloud/billing" },
            ],
          },
        ],
      },

      search: {
        provider: "local",
        options: {
          _render(src, env, md) {
            const html = md.render(src, env);
            return env.relativePath.startsWith("self-hosting/") ? "" : html;
          },
        },
      },
    },

    mermaid: {
      theme: "base",
      themeVariables: {
        fontFamily: "Figtree, system-ui, sans-serif",
        primaryColor: "#e8f0fe",
        primaryBorderColor: "#0b57d0",
        primaryTextColor: "#202124",
        lineColor: "#5f6368",
        secondaryColor: "#f8f9fa",
        tertiaryColor: "#ffffff",
      },
    },

    vite: {
      plugins: [
        llmstxt({ domain: "https://docs.signalscout.run", ignoreFiles: ["self-hosting/**"] }),
      ],
      // Mermaid imports CommonJS modules (fastdom among them). The build
      // bundles them, but the dev server serves them as they are, and the
      // page stays blank on "does not provide an export named 'default'".
      optimizeDeps: { include: ["mermaid"] },
    },
  }),
);
