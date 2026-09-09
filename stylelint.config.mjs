/** @type {import('stylelint').Config} */
export default {
  rules: {
    /*
     * Spacing is on the scale. A `padding`, `margin` or `gap` is `0`, `auto`,
     * a `var(--space-*)` token, or a `calc()` of those — never a raw px.
     *
     * Hairline values (a 1–2px border width) and non-spacing lengths (radius,
     * width, height, a shadow offset) are unaffected: they are not matched
     * here. Read docs/spacing.md.
     */
    "declaration-property-value-allowed-list": {
      "/^(padding|margin|gap)(-.*)?$/": [
        /^(0|auto|var\(--[\w-]*\)|calc\((?:[^()]|\([^()]*\))*\))(\s+(0|auto|var\(--[\w-]*\)|calc\((?:[^()]|\([^()]*\))*\)))*$/,
      ],
    },
  },
};
