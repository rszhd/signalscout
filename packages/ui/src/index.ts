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
export { FormError, type FormErrorProps } from "./components/FormError.js";
export { PageState, type PageStateProps } from "./components/PageState.js";
export {
  type DraftedProject,
  DraftFromDocument,
  type DraftFromDocumentProps,
} from "./DraftFromDocument.js";
export {
  ArrivedBanner,
  InboxFilters,
  type InboxFiltersProps,
  MatchListHeading,
  ShowMore,
} from "./InboxFilters.js";
export { LeadSources, type LeadSourcesProps } from "./LeadSources.js";
export { LoginFrame, type LoginFrameProps } from "./LoginFrame.js";
export { ageLabel, platformName, providerName, untilLabel } from "./labels.js";
export { MatchCard, type MatchCardProps } from "./MatchCard.js";
export { MatchDetail, type MatchDetailProps } from "./MatchDetail.js";
export { MonitorHistory, type MonitorHistoryProps } from "./MonitorHistory.js";
export { MonitoringBar, type MonitoringBarProps } from "./MonitoringBar.js";
export { MonitorStatus, type MonitorStatusProps } from "./MonitorStatus.js";
export {
  activeFilters,
  type InboxFilterState,
  type InboxOrder,
  inboxOrders,
  limitWords,
  type Match,
  opensThreadOnly,
  type PlatformLabel,
  platformLabel,
  postPreviewWordLimit,
  scoreFilters,
  threadDepth,
  type Verdict,
  whereItCameFrom,
} from "./match.js";
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
export {
  defaultLeadDimensions,
  inputKey,
  type LeadBreakdown,
  type LeadDimension,
  type LeadDimensionWords,
  type LeadGroup,
  leadDimensionWords,
  leadGroupName,
  type QueryPerformanceRow,
  type SearchInput,
  searchInputs,
} from "./monitor-stats.js";
export {
  AccountIdentity,
  NavIcon,
  type NavIconName,
  NavItem,
  type NavItemProps,
  SignOut,
} from "./Nav.js";
export {
  Notifications,
  type NotificationsProps,
  type SigningSecret,
} from "./Notifications.js";
export { ProjectCard, type ProjectCardProps } from "./ProjectCard.js";
export { QueryPerformance, type QueryPerformanceProps } from "./QueryPerformance.js";
export { ReplyDraft } from "./ReplyDraft.js";
export { ReplyVoices } from "./ReplyVoices.js";
export {
  browserTimezone,
  type DayRuleKey,
  dayInitials,
  dayNames,
  dayRuleOf,
  dayRules,
  daysPhrase,
  defaultRate,
  describeSchedule,
  everyDay,
  type PollRate,
  pollRateLabel,
  pollRates,
  summarise,
  timezoneOptions,
  weekdays,
  weekends,
} from "./schedule.js";
