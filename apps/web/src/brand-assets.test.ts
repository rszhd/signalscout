import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const web = new URL("../", import.meta.url);
const publicFile = (path: string) => new URL(`public/${path}`, web);
const read = (path: string) => readFileSync(publicFile(path));
const sha256 = (path: string) => createHash("sha256").update(read(path)).digest("hex");

describe("the application brand assets", () => {
  it("points browser chrome at the canonical icon set", () => {
    const html = readFileSync(new URL("index.html", web), "utf8");

    expect(html).toContain('<meta name="theme-color" content="#f8fafd" />');
    expect(html).toContain('href="/favicon.ico"');
    expect(html).toContain('href="/brand/mark-small.svg"');
    expect(html).toContain('href="/brand/apple-touch-icon.png"');
    expect(html).toContain('href="/site.webmanifest"');
    expect(html).not.toContain("favicon.svg");
  });

  it("ships the nine-dot mark and the small favicon cut", () => {
    const mark = read("brand/mark.svg").toString("utf8");
    const smallMark = read("brand/mark-small.svg").toString("utf8");
    const packageMark = readFileSync(
      new URL("../../../packages/ui/src/assets/mark.svg", import.meta.url),
      "utf8",
    );
    const packageSmallMark = readFileSync(
      new URL("../../../packages/ui/src/assets/mark-small.svg", import.meta.url),
      "utf8",
    );
    const manifest = JSON.parse(read("site.webmanifest").toString("utf8")) as {
      icons: Array<{ src: string }>;
      theme_color: string;
    };

    expect(mark.match(/<circle /g)).toHaveLength(9);
    expect(mark).toContain('fill="#0b57d0"');
    expect(mark).toBe(packageMark);
    expect(smallMark).toBe(packageSmallMark);
    expect(manifest.theme_color).toBe("#f8fafd");
    expect(manifest.icons.map(({ src }) => src)).toEqual([
      "/brand/icon-192.png",
      "/brand/icon-512.png",
      "/brand/icon-512-maskable.png",
    ]);

    expect({
      favicon: sha256("favicon.ico"),
      appleTouch: sha256("brand/apple-touch-icon.png"),
      icon192: sha256("brand/icon-192.png"),
      icon512: sha256("brand/icon-512.png"),
      icon512Maskable: sha256("brand/icon-512-maskable.png"),
      legacyRasterEntry: sha256("logo.png"),
    }).toEqual({
      favicon: "768fd81e4318ba1d0afa1fce25fd3a9342ef9db04b04dd6998986d8010671dfc",
      appleTouch: "c1d6d813a97bd075241f89f8f147c0d0a339422c36a2df15b51254401d35c7a3",
      icon192: "3a1e5a41e8b659364a3ddcb15aa61332afc704855c0f1b97192976af5326d1ac",
      icon512: "9a8ddc47b0a1125fdad14c7bfaf6d10b6716dd55ec7bc9d69c03c84f9a76122b",
      icon512Maskable: "40dac1ce0f483192d6460a4a9529d2bf0bc2ec251002943dd8da7bc05845bd45",
      legacyRasterEntry: "9a8ddc47b0a1125fdad14c7bfaf6d10b6716dd55ec7bc9d69c03c84f9a76122b",
    });
  });
});
