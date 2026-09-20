/**
 * SignalScout's brand, for both applications. US-270.
 *
 * What is here: the token contract and the shared controls (`tokens.css` and
 * `theme.css`), the primitives every screen builds from, the mark, and the
 * words both products say about a monitor, a poll, a stage and a match.
 *
 * What is not: a screen, a page stylesheet, a route table or any layout. Each
 * application owns those and they are free to differ — one monitor per
 * project hosted, five steps and a budget self-hosted. The brand is one; the
 * screens are two.
 *
 * The rule that keeps it that way: **a shared control uses a token name and
 * never a raw colour or a raw spacing value.** `stylelint` says so to CI.
 */
export { ApiError, codeFor, messageFor, requestJson } from "./api.js";
export { BrandIcon } from "./BrandIcon.js";
export { BrandLogo } from "./BrandLogo.js";
export { Button } from "./components/Button.js";
export { Dialog } from "./components/Dialog.js";
export { Field } from "./components/Field.js";
export { ageLabel, platformName, providerName, untilLabel } from "./labels.js";
export {
  type ActivityEntry,
  type ActivityGroup,
  activityGroupsOf,
  anyWorking,
  type Budget,
  band,
  type Feedback,
  feedbackLabel,
  formatMicros,
  idleRefreshMs,
  type LastCollection,
  type MatchCounts,
  type MissingCredential,
  type Monitor,
  type Monitoring,
  monitoringState,
  monthLabel,
  needsAttention,
  nextPollAt,
  nextPollLabel,
  type PollRun,
  type PollRunSource,
  type PollSentence,
  type PollSubject,
  type PreFilter,
  pollSummary,
  type Spend,
  type Stage,
  type StageRun,
  type StageRunDetail,
  stageDidLabel,
  stageLabel,
  stageLine,
  stageOf,
  status,
  stopReasonLabel,
  toMicros,
  useMonitorRefresh,
  workingRefreshMs,
} from "./monitor.js";
