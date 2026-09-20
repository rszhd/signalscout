/**
 * The bundler's own environment, for the one value a shared component needs.
 *
 * `BrandIcon` finds the provider and platform icons under the application's
 * base path, and `vite/client` is not a dependency of a package — so the one
 * field it reads is declared here. Optional, because a consumer that is not
 * Vite has no such object and the component falls back to the site root.
 *
 * Nothing else in this package reads an environment at all:
 * `ui-boundary.test.ts` proves it, and the words import nothing.
 */
interface ImportMeta {
  readonly env?: { readonly BASE_URL?: string };
}
