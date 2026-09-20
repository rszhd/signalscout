/**
 * The product mark. Nine positions on a lattice, one of them found.
 *
 * `mark.svg` is the canonical nine-dot cut and needs 24px or more; below that
 * the tint dots blur together and `brand/mark-small.svg` takes over. Every
 * place this component renders is 32px or larger, so no caller has to choose.
 * Applications provide the files under `/brand/` so browser chrome and the UI
 * render the same artwork.
 */
export function BrandLogo({ size = 32 }: { readonly size?: number } = {}) {
  return <img className="brand-logo" src="/brand/mark.svg" width={size} height={size} alt="" />;
}
