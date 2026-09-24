/**
 * Writes `email-mark.ts`: the product mark as a PNG, for the email header.
 * US-095.
 *
 *     pnpm --filter @signalscout/pipeline generate:email-mark
 *
 * The source is `packages/ui/src/assets/mark.svg`, the canonical mark. This
 * package may not import the UI package, and the worker that sends a digest
 * may run without the web app, so the PNG is generated into this package as
 * source rather than read at send time. `email-mark.test.ts` runs the
 * rendering again and fails when the committed file no longer matches the SVG.
 *
 * The mark is circles and nothing else, so it is drawn here with Node's own
 * `zlib` rather than a rasterizer dependency. An SVG with any other element is
 * refused, because this drawing would silently leave that element out.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";

/** Drawn at 64 for a 32-pixel header, so a 2x screen gets a sharp mark. */
export const emailMarkPixels = 64;

/** Samples per pixel on each axis. 4 gives the edge 16 levels of coverage. */
const samples = 4;

interface Circle {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  readonly rgb: readonly [number, number, number];
}

function circlesIn(svg: string): { size: number; circles: Circle[] } {
  const viewBox = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  if (!viewBox || viewBox[1] !== viewBox[2]) throw new Error("The mark must have a square viewBox");

  const elements = [...svg.matchAll(/<([a-z]+)\b/g)].map((match) => match[1]);
  const other = elements.filter((name) => name !== "svg" && name !== "circle");
  if (other.length > 0) throw new Error(`The mark holds more than circles: ${other.join(", ")}`);

  const circles = [
    ...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)" fill="#([0-9a-f]{6})"\/>/g),
  ].map(([, cx, cy, r, hex]) => ({
    cx: Number(cx),
    cy: Number(cy),
    r: Number(r),
    rgb: [0, 2, 4].map((at) => Number.parseInt((hex as string).slice(at, at + 2), 16)) as [
      number,
      number,
      number,
    ],
  }));
  if (circles.length !== elements.filter((name) => name === "circle").length) {
    throw new Error("A circle in the mark is written in a form this drawing does not read");
  }

  return { size: Number(viewBox[1]), circles };
}

function png(width: number, height: number, rgba: Buffer): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, no interlace.

  // Each row starts with filter type 0, "none".
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(rows, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** The mark as PNG bytes, `pixels` square, on a transparent background. */
export function renderEmailMark(svg: string, pixels = emailMarkPixels): Buffer {
  const { size, circles } = circlesIn(svg);
  const scale = pixels / size;
  const rgba = Buffer.alloc(pixels * pixels * 4);

  for (let y = 0; y < pixels; y += 1) {
    for (let x = 0; x < pixels; x += 1) {
      // Colour and coverage summed over the samples, so an edge pixel gets
      // the share of the circle that falls inside it.
      let red = 0;
      let green = 0;
      let blue = 0;
      let covered = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const px = (x + (sx + 0.5) / samples) / scale;
          const py = (y + (sy + 0.5) / samples) / scale;
          const hit = circles.find(({ cx, cy, r }) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r);
          if (!hit) continue;
          red += hit.rgb[0];
          green += hit.rgb[1];
          blue += hit.rgb[2];
          covered += 1;
        }
      }

      if (covered === 0) continue;
      const at = (y * pixels + x) * 4;
      rgba[at] = Math.round(red / covered);
      rgba[at + 1] = Math.round(green / covered);
      rgba[at + 2] = Math.round(blue / covered);
      rgba[at + 3] = Math.round((covered / (samples * samples)) * 255);
    }
  }

  return png(pixels, pixels, rgba);
}

export const markSource = new URL("../../../ui/src/assets/mark.svg", import.meta.url);

/** The generated module's text, for the file and for the test that checks it. */
export function emailMarkModule(svg: string): string {
  const hash = createHash("sha256").update(svg).digest("hex");
  const base64 = renderEmailMark(svg).toString("base64");

  return [
    "// Generated by email-mark-generate.ts from packages/ui/src/assets/mark.svg.",
    "// Do not edit. Run `pnpm --filter @signalscout/pipeline generate:email-mark`.",
    "",
    "/** The SHA-256 of the SVG this was drawn from. */",
    "export const emailMarkSourceSha256 =",
    `  "${hash}";`,
    "",
    `/** A ${emailMarkPixels}-pixel PNG of the mark, base64. */`,
    "export const emailMarkPng =",
    `  "${base64}";`,
    "",
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const svg = readFileSync(markSource, "utf8");
  const out = new URL("./email-mark.ts", import.meta.url);
  writeFileSync(out, emailMarkModule(svg));
  console.log(`Wrote ${fileURLToPath(out)}: ${renderEmailMark(svg).length} bytes of PNG.`);
}
