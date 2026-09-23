#!/usr/bin/env node
/**
 * Save the README banner as `docs/img/banner.png`.
 *
 * The banner is a story in the UI package, `Brand/README banner`, so it is
 * drawn by the product's own components and tokens and changes when they do.
 * This takes its picture with the Google Chrome already on the machine, in
 * headless mode, at twice the size so it stays sharp on a dense screen. No
 * browser library is installed for one picture.
 *
 *   pnpm --filter @signalscout/ui storybook      # in another terminal
 *   node scripts/readme-banner.mjs
 *
 * STORYBOOK_URL points at another preview; CHROME names another browser.
 */
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";

const storybook = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6006";
const out = fileURLToPath(new URL("../docs/img/banner.png", import.meta.url));
const story = `${storybook}/iframe.html?id=brand-readme-banner--default&viewMode=story`;

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
    try {
      return execFileSync("which", [name], { encoding: "utf8" }).trim();
    } catch {}
  }
  console.error("readme-banner — no Chrome or Chromium found; set CHROME to one.");
  process.exit(1);
}

try {
  execFileSync("curl", ["-sf", "-o", "/dev/null", `${storybook}/index.json`]);
} catch {
  console.error(`readme-banner — no Storybook at ${storybook}. Start it first:`);
  console.error("  pnpm --filter @signalscout/ui storybook");
  process.exit(1);
}

// The size is the story's canvas. The time budget lets React render and the
// font load before the picture is taken.
execFileSync(
  chrome(),
  [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--force-device-scale-factor=2",
    "--window-size=1280,400",
    "--virtual-time-budget=8000",
    `--screenshot=${out}`,
    story,
  ],
  { stdio: ["ignore", "ignore", "ignore"] },
);

console.log(`Saved ${out} (${Math.round(statSync(out).size / 1024)} KB).`);
