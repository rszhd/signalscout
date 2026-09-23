/**
 * What every story renders inside. US-351.
 *
 * The package's stylesheet over the base an application gives it
 * (`preview.css`), a router because `ProjectCard` links with one, and the fake
 * API a story names in `parameters.api`.
 */
import type { Preview } from "@storybook/react-vite";
import { MemoryRouter } from "react-router";
import { type ApiRoutes, fakeFetch } from "./api.js";
import "./preview.css";

const preview: Preview = {
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  // Before the story renders, so the component's first fetch already meets
  // the fake. The return value puts the real one back.
  beforeEach: ({ parameters }) => {
    const routes = parameters.api as ApiRoutes | undefined;
    if (!routes) return;

    const real = globalThis.fetch;
    globalThis.fetch = fakeFetch(routes);
    return () => {
      globalThis.fetch = real;
    };
  },
  parameters: {
    layout: "padded",
    controls: { expanded: true },
    // A failure the a11y panel reports is shown, not thrown: the preview is
    // for looking, and the stories are not tests yet (US-351 Context).
    a11y: { test: "todo" },
  },
};

export default preview;
