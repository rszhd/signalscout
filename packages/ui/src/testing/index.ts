/**
 * What a test of a screen needs: the fixtures, and the harness. US-270, US-274.
 *
 * The fixtures are a monitor row and a poll row as an API sends them, so a
 * test of a sentence does not have to write twenty fields to assert one. The
 * harness mounts a screen into a real document and finds what a person finds,
 * by the label or the words on the button. It was byte-identical in the two
 * applications when it moved here, and a harness that drifts is worse than a
 * screen that drifts: two suites come to mean different things while every
 * case still passes.
 *
 * Its own entry point, the way `@signalscout/pipeline/testing` is: nothing a
 * fixture or a harness knows belongs in a bundle a person downloads. It needs
 * `react-dom` and a document, so it is imported only where a `jsdom`
 * environment is on.
 */

export { pollEntry, stageEntry } from "./activity.js";
export {
  button,
  field,
  json,
  mount,
  radio,
  type Screen,
  select,
  settle,
  setValue,
} from "./harness.js";
export { match } from "./matches.js";
export { monitor, poll, testMonitorId, testProjectId } from "./monitors.js";
