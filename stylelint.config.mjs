/** @type {import('stylelint').Config} */
export default {
  rules: {
    /*
     * Spacing is on the scale. A `padding`, `margin` or `gap` is `0`, `auto`,
     * a `var(--space-*)` token, or a `calc()` of those — never a raw px.
     *
     * Three things are allowed beside a token. A hairline, 1px or 2px, which
     * the scale has no step for and which the design document exempts. A
     * `clamp()`, `min()` or `max()` of tokens, which is how a gutter grows
     * with the viewport. And `auto`. Read packages/ui/README.md, *Spacing*.
     */
    "declaration-property-value-allowed-list": {
      "/^(padding|margin|gap)(-.*)?$/": [
        /^(0|auto|1px|2px|var\(--[\w-]*\)|(calc|clamp|min|max)\((?:[^()]|\([^()]*\))*\))(\s+(0|auto|1px|2px|var\(--[\w-]*\)|(calc|clamp|min|max)\((?:[^()]|\([^()]*\))*\)))*$/,
      ],
    },

    /*
     * A colour is a token, never a literal. US-270.
     *
     * The two applications wear one brand, and they can only do that while a
     * control names `var(--accent)` rather than the hex behind it: the day a
     * screen writes `#0b57d0`, that screen stops following the brand and
     * nothing says so. `tokens.css` is where the literals live, and it is the
     * one file this rule does not apply to.
     *
     * A platform's own brand colour is the exception the rule cannot see, so
     * it is declared as a token in `tokens.css` like the rest.
     */
    "declaration-property-value-disallowed-list": {
      "/^(color|background|background-color|border|border-.*-color|outline|outline-color|fill|stroke|box-shadow|text-shadow)$/":
        [/#[0-9a-fA-F]{3,8}\b/, /\b(rgba?|hsla?|oklch|lab)\(/],
    },
  },
  overrides: [
    {
      // The literals' one home. Every other file names them.
      files: ["**/tokens.css"],
      rules: { "declaration-property-value-disallowed-list": null },
    },
    {
      /*
       * Two pages carry a whole older palette — greens and ambers the brand
       * does not have — from before the theme was redrawn. Naming twelve
       * one-page colours as brand tokens would be worse than the debt, so
       * they are exempt until the pages adopt the palette. US-272 is that
       * work, and this list is what it deletes.
       */
      files: ["apps/web/src/styles/reply-draft.css", "apps/web/src/styles/reply-voices.css"],
      rules: { "declaration-property-value-disallowed-list": null },
    },
  ],
};
