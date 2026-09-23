/**
 * The component preview. US-351.
 *
 * Every component this package exports, rendered on its own with fixture data
 * and no server: `pnpm --filter @signalscout/ui storybook`. A story sits
 * beside its component as `<Name>.stories.tsx`; `tsconfig.json` leaves them
 * out of `dist`, so none reaches the tarball.
 *
 * Telemetry is off. Storybook sends usage data by default, and a contributor
 * who runs the preview has not agreed to that.
 */
import { defineMain } from "@storybook/react-vite/node";
import react from "@vitejs/plugin-react";

export default defineMain({
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.tsx"],
  addons: ["@storybook/addon-a11y"],
  core: { disableTelemetry: true },
  staticDirs: [
    // `BrandLogo` reads `/brand/mark.svg`, which an application copies from
    // this package's own assets. The preview serves the source.
    { from: "../src/assets", to: "/brand" },
    // The platform and provider icons are the applications', not this
    // package's (README, "What a consumer must provide"). The open
    // application's copy is the one this repository holds.
    { from: "../../../apps/web/public/brands", to: "/brands" },
  ],
  // No `vite.config` in this package, so the React plugin is added here.
  viteFinal: (config) => ({ ...config, plugins: [...(config.plugins ?? []), react()] }),
});
