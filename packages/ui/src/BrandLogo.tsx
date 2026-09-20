/**
 * The product mark: nine positions on a lattice, one of them found.
 *
 * **Drawn here rather than imported as a file.** An `<img>` cannot read the
 * page's custom properties, so a mark in a file has the palette baked into it
 * and a brand with two hex numbers is a brand that drifts. Inline, the dots
 * are `var(--accent-tint)` and the found one is `var(--accent)` — the mark
 * follows the tokens like everything else. It also keeps this package free of
 * asset imports, so a consumer that is not a bundler can still read its words.
 *
 * `size` is 32 by default and no caller passes less. Below 24 the eight tint
 * dots blur together; the four-dot cut that used to exist for that case is
 * gone, because nothing renders the mark that small.
 */
export function BrandLogo({ size = 32 }: { readonly size?: number } = {}) {
  return (
    <svg
      className="brand-logo"
      viewBox="0 0 130 130"
      width={size}
      height={size}
      role="img"
      aria-label="SignalScout"
    >
      {[
        [9, 21],
        [59, 21],
        [9, 71],
        [59, 71],
        [109, 71],
        [9, 121],
        [59, 121],
        [109, 121],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="9" fill="var(--accent-tint)" />
      ))}
      {/* The one that was found: larger, and the brand's own blue. */}
      <circle cx="109" cy="21" r="21" fill="var(--accent)" />
    </svg>
  );
}
