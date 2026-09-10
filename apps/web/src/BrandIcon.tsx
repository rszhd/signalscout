import { useState } from "react";

/** Local originals and their download sources are recorded in public/brands/README.md. */
const icons: Record<string, string> = {
  brightdata: "brightdata.png",
  scrapecreators: "scrapecreators.png",
  socialcrawl: "socialcrawl.png",
  apify: "apify.png",
  socialdata: "socialdata.png",
  reddit: "reddit.png",
  x: "x.png",
  linkedin: "linkedin.ico",
  youtube: "youtube.png",
  tiktok: "tiktok.png",
  instagram: "instagram.png",
  anthropic: "anthropic.ico",
  openai: "openai.png",
  google: "google.ico",
  openrouter: "openrouter.ico",
  ollama: "ollama.png",
};

/** Decorative: callers keep the provider/platform name alongside the icon. */
export function BrandIcon({ brand, size = 20 }: { brand: string; size?: number }) {
  const file = icons[brand.toLowerCase()];
  const [failedFile, setFailedFile] = useState<string | null>(null);

  if (!file || failedFile === file) {
    return (
      <span
        className="brand-icon brand-icon-fallback"
        aria-hidden="true"
        style={{ width: size, height: size }}
      >
        {brand.slice(0, 2).toUpperCase()}
      </span>
    );
  }

  return (
    <img
      className="brand-icon"
      src={`${import.meta.env.BASE_URL}brands/${file}`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      onError={() => setFailedFile(file)}
    />
  );
}
