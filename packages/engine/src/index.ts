/**
 * The stateless half of the product: connectors, model calls, the pre-filter,
 * the estimate, the classification vocabulary and the cipher. Input in, result
 * and cost out. `engine-boundary.test.ts` is the definition of "stateless".
 *
 * `packages/pipeline` re-exports all of this, so an application imports one
 * package today. US-152.
 */
export {
  generateStructured,
  type ModelCall,
  type StructuredCallOptions,
  type StructuredResult,
} from "./ai/call.js";
export {
  type Classification,
  classificationSchema,
  leadScore,
  maximumReasons,
  minimumReasons,
  relevanceFloor,
  relevanceGate,
  restatesTheScores,
  scoreColumns,
  scoreWeights,
} from "./ai/classification.js";
export {
  type ClassificationOutcome,
  type Classifier,
  type ClassifierOptions,
  type ClassifyRequest,
  createClassifier,
} from "./ai/classify.js";
export {
  type AiConfig,
  type AiEnvironment,
  type AiProvider,
  aiConfigFromEnvironment,
  aiProviders,
  canEmbed,
  defaultEmbeddingModels,
  draftConfigFromEnvironment,
  type EmbeddingConfig,
  type EmbeddingProvider,
  embeddingConfigFromEnvironment,
  embeddingNeedsApiKey,
  embeddingProviders,
  isEvaluationProvider,
  needsApiKey,
  triageConfigFromEnvironment,
  triageIsOff,
} from "./ai/config.js";
export {
  createProjectDescriber,
  type DescribeResult,
  describeProject,
  maximumDocumentCharacters,
  type ProjectDescriber,
  type ProjectDraft,
} from "./ai/describe.js";
export { createDrafter, type Drafter, type DraftOutcome, type DraftRequest } from "./ai/draft.js";
export {
  createEmbedder,
  createEmbeddingModel,
  type Embedder,
  type EmbedderOptions,
  type EmbedOutcome,
  estimateEmbeddingCostMicros,
  MissingEmbeddingKeyError,
} from "./ai/embed.js";
export { aiEnvSchema, aiFields, blankIsUnset, booleanFromEnv } from "./ai/env.js";
export {
  type ModelProbe,
  type ModelProbeStatus,
  probeChatModel,
  probeEmbeddingModel,
} from "./ai/probe.js";
export {
  buildSystemPrompt,
  buildUserPrompt,
  type MonitorProfile,
  type PostForClassification,
  type ThreadContext,
} from "./ai/prompt.js";
export {
  createEvaluationModel,
  createModel,
  type EvaluationModelInstance,
  EvaluationProviderCannotChatError,
  estimateCostMicros,
  MissingAiKeyError,
  modelPrices,
  NotAnEvaluationProviderError,
  pricedModelsFor,
  schemaGoesInThePrompt,
  unpricedModelsFor,
} from "./ai/provider.js";
export {
  buildQuerySystemPrompt,
  buildQueryUserPrompt,
  createQueryGenerator,
  maximumQueries,
  maximumSubreddits,
  minimumQueries,
  type QueryGenerator,
  type QueryGeneratorOptions,
  type QueryPlan,
  type QueryPlanOutcome,
  queryListSchemaFor,
  queryPlanSchemaFor,
  searchQuerySchema,
  searchQuerySchemaFor,
  subredditSchema,
} from "./ai/queries.js";
export {
  followsDefault,
  recommendationsFor,
  recommendedModelFor,
  recommendedProviders,
} from "./ai/recommended.js";
export {
  buildReplySystemPrompt,
  buildReplyUserPrompt,
  type Draft,
  draftSchema,
  type ReplyVoice,
} from "./ai/reply.js";
export { type ReplyVoicePreset, replyVoicePresets } from "./ai/reply-voices.js";
export {
  createTriager,
  type ItemForTriage,
  type TriageOutcome,
  type TriageRequest,
  type Triager,
  type TriagerOptions,
  type TriageVerdict,
  triageSchema,
} from "./ai/triage.js";
export {
  daysPerMonth,
  type EstimateSample,
  type EstimateTotals,
  exceedsCap,
  maxEstimateAttempts,
  type PollShape,
  type ProbeRequest,
  type Projection,
  postsPerDay,
  probesFor,
  projectMonthly,
  sampleExcerptLength,
  samplePostsPerProbe,
  samplesKept,
  sampleWindowDays,
  shortestObservedSpanHours,
  totalsFor,
} from "./estimate/estimate.js";
export {
  type EmbeddablePost,
  type MonitorDescription,
  monitorDescriptionText,
  postEmbeddingText,
} from "./filter/description.js";
export {
  type FilterablePost,
  type KeywordRule,
  keepsPost,
  keywordRuleFor,
  ruleIsEmpty,
} from "./filter/keywords.js";
export { createLogger, type Logger, type LoggerOptions, redactedFields } from "./logger.js";
export { configureNetworking, connectAttemptTimeoutMs } from "./net.js";
export {
  decryptSecret,
  type EncryptionKey,
  encryptionKeyIsWellFormed,
  encryptSecret,
  generateEncryptionKey,
  InvalidEncryptionKeyError,
  MissingEncryptionKeyError,
  maskSecret,
  optionalEncryptionKey,
  readEncryptionKey,
  requireEncryptionKey,
  secretsMatch,
  UndecryptableSecretError,
} from "./secrets/cipher.js";
export {
  describeSignals,
  intentTypeLabel,
  type SignalDescription,
  signalDescriptions,
  signalList,
} from "./signals.js";
export * from "./sources/index.js";
export {
  type AiTask,
  aiTasks,
  defaultMinimumScore,
  defaultSimilarityThreshold,
  embeddingDimensions,
  type IntentType,
  intentTypes,
  type Provider,
  providers,
  type Signal,
  type Source,
  signals,
  sources,
} from "./vocabulary.js";
