import { z } from "zod";
import { actionPressureLevelSchema } from "./action-pressure.js";
import { contextBudgetSchema } from "./context-contracts.js";
import { stableIdSchema } from "./identity.js";
import { jsonValueSchema } from "./json.js";
import { mutationProposalSchema } from "./operations.js";
import { playerActionRequestSchema } from "./player-action-contracts.js";

const durationMsSchema = z.number().int().nonnegative();

export const communicationInputModeSchema = z.enum([
  "described",
  "quoted",
  "mixed",
]);

export const communicationSemanticKindSchema = z.enum([
  "question",
  "assertion",
  "request",
  "disclosure",
  "promise",
  "threat",
  "offer",
  "agreement",
  "apology",
  "other",
]);

export const materialCommunicationSemanticKindSchema = z.enum([
  "disclosure",
  "promise",
  "threat",
  "offer",
  "agreement",
]);

export const authorizedTestimonySchema = z.object({
  id: stableIdSchema,
  subjectId: stableIdSchema,
  proposition: z.string().trim().min(1),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("fact"), id: stableIdSchema }).strict(),
    z.object({ kind: z.literal("belief"), id: stableIdSchema }).strict(),
  ]),
}).strict();
export type AuthorizedTestimony = z.infer<typeof authorizedTestimonySchema>;

export const communicationInterpretationSchema = z.object({
  inputMode: communicationInputModeSchema,
  exactQuoteFragments: z.array(z.string().min(1)),
  semanticKinds: z.array(communicationSemanticKindSchema).min(1),
  authorizedContent: z.string().trim().min(1),
  intendedSocialEffect: z.string().trim().min(1).optional(),
  testimonyIds: z.array(stableIdSchema),
  materialCommitments: z.array(z.string().trim().min(1)),
  deliveryIntent: z.enum(["honest", "withhold", "deceive"]),
  containsNonSpeechAction: z.boolean(),
  estimatedDurationMs: durationMsSchema,
  pressureLevel: actionPressureLevelSchema,
}).strict();
export type CommunicationInterpretation = z.infer<
  typeof communicationInterpretationSchema
>;

export const communicationActSchema = z.object({
  id: stableIdSchema,
  interactionId: stableIdSchema,
  speakerId: stableIdSchema,
  recipientIds: z.array(stableIdSchema).min(1),
  inputMode: communicationInputModeSchema,
  exactQuoteFragments: z.array(z.string().min(1)),
  semanticKinds: z.array(communicationSemanticKindSchema).min(1),
  authorizedContent: z.string().trim().min(1),
  intendedSocialEffect: z.string().trim().min(1).optional(),
  testimony: z.array(authorizedTestimonySchema),
  materialCommitments: z.array(z.string().trim().min(1)),
  deliveryIntent: z.enum(["honest", "withhold", "deceive"]),
  groundingIds: z.array(stableIdSchema),
  containsNonSpeechAction: z.boolean(),
  durationMs: durationMsSchema,
}).strict().superRefine((act, context) => {
  if (act.inputMode === "described" && act.exactQuoteFragments.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Described speech cannot contain literal quote fragments",
      path: ["exactQuoteFragments"],
    });
  }
  if (act.inputMode !== "described" && act.exactQuoteFragments.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Quoted or mixed speech requires a literal quote fragment",
      path: ["exactQuoteFragments"],
    });
  }
  if (act.deliveryIntent === "deceive" && act.testimony.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Deceptive claims require explicit social resolution before they may create testimony-derived beliefs",
      path: ["testimony"],
    });
  }
});
export type CommunicationAct = z.infer<typeof communicationActSchema>;

export const sceneLocalNpcStateSchema = z.object({
  actorId: stableIdSchema,
  interpretation: z.string().trim().min(1),
  attention: z.array(z.string().trim().min(1)),
  immediatePriorities: z.array(z.string().trim().min(1)),
  stance: z.string().trim().min(1),
  wants: z.array(z.string().trim().min(1)),
  reluctantToRevealIds: z.array(stableIdSchema),
  considering: z.array(z.string().trim().min(1)),
  unresolvedQuestions: z.array(z.string().trim().min(1)),
}).strict();
export type SceneLocalNpcState = z.infer<typeof sceneLocalNpcStateSchema>;

export const conversationStopReasonSchema = z.enum([
  "meaningful-player-choice",
  "answer-expected",
  "material-circumstance-change",
  "pc-behavior-required",
  "pressure-boundary",
  "no-material-reaction",
  "safety-ceiling",
]);
export type ConversationStopReason = z.infer<
  typeof conversationStopReasonSchema
>;

export const actorOperationProposalSchema = z.object({
  kind: z.enum(["ordinary-operation", "resolution-operation"]),
  toolId: stableIdSchema,
  arguments: jsonValueSchema,
  goal: z.string().trim().min(1),
  targetRefs: z.array(stableIdSchema),
  requestedHorizonMs: durationMsSchema,
  estimatedDurationMs: durationMsSchema,
}).strict();
export type ActorOperationProposal = z.infer<
  typeof actorOperationProposalSchema
>;

export const npcDisclosureDecisionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("none") }).strict(),
  z.object({
    mode: z.enum(["disclose", "withhold"]),
    groundingIds: z.array(stableIdSchema).min(1),
  }).strict(),
  z.object({
    mode: z.literal("deceive"),
    groundingIds: z.array(stableIdSchema).min(1),
    claim: z.string().trim().min(1),
  }).strict(),
]);

export const npcDecisionSchema = z.object({
  actorId: stableIdSchema,
  interpretation: z.string().trim().min(1),
  responseKind: z.enum([
    "speak",
    "act",
    "both",
    "no-material-response",
  ]),
  intendedSpeechSemantics: z.string().trim().min(1).optional(),
  speechSemanticKinds: z.array(communicationSemanticKindSchema),
  estimatedSpeechDurationMs: durationMsSchema,
  disclosure: npcDisclosureDecisionSchema,
  intendedSocialEffect: z.string().trim().min(1).optional(),
  proposedAction: actorOperationProposalSchema.optional(),
  sceneState: sceneLocalNpcStateSchema,
  requiresAuthoritativeResolution: z.boolean(),
  stopReason: conversationStopReasonSchema,
}).strict().superRefine((decision, context) => {
  const speaks = decision.responseKind === "speak" ||
    decision.responseKind === "both";
  const acts = decision.responseKind === "act" || decision.responseKind === "both";
  if (speaks !== Boolean(decision.intendedSpeechSemantics)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Speech response kind and intended speech semantics must agree",
      path: ["intendedSpeechSemantics"],
    });
  }
  if (acts !== Boolean(decision.proposedAction)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Action response kind and proposed action must agree",
      path: ["proposedAction"],
    });
  }
  if (decision.requiresAuthoritativeResolution !== acts) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Consequential NPC actions require authoritative execution",
      path: ["requiresAuthoritativeResolution"],
    });
  }
  if (!speaks && decision.speechSemanticKinds.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A non-speaking decision cannot declare speech semantics",
      path: ["speechSemanticKinds"],
    });
  }
  if (speaks && decision.estimatedSpeechDurationMs === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A speaking decision requires a positive estimated speech duration",
      path: ["estimatedSpeechDurationMs"],
    });
  }
  if (!speaks && decision.estimatedSpeechDurationMs !== 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A non-speaking decision cannot consume speech time",
      path: ["estimatedSpeechDurationMs"],
    });
  }
});
export type NpcDecision = z.infer<typeof npcDecisionSchema>;

/**
 * LM-05: final dialogue or an explicit request for authoritative escalation.
 * No canonical entity IDs, numeric social effects, operation arguments, or
 * invented facts are part of an ordinary reply.
 */
export const npcReplySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ordinary"),
    speech: z.string().max(900),
    visibleManner: z.string().trim().min(1).max(160).optional(),
    continueConversation: z.boolean(),
    materialSignal: z.literal("none"),
  }).strict(),
  z.object({
    kind: z.literal("escalate"),
    reason: z.enum([
      "commitment", "disclosure", "social-conflict", "npc-action",
      "trade", "other",
    ]),
    proposedSpeech: z.string().max(900).optional(),
    proposedActionSummary: z.string().max(250).optional(),
  }).strict(),
]);
export type NpcReply = z.infer<typeof npcReplySchema>;

export const conversationTranscriptEntrySchema = z.object({
  beat: z.number().int().positive(),
  speakerId: stableIdSchema,
  audienceIds: z.array(stableIdSchema),
  kind: z.enum(["player-act", "npc-semantics", "narration"]),
  content: z.string().min(1),
  exactQuoteFragments: z.array(z.string().min(1)),
}).strict();

export const conversationWorkingStateSchema = z.object({
  interactionId: stableIdSchema,
  participantIds: z.array(stableIdSchema).min(1),
  beat: z.number().int().nonnegative(),
  npcStates: z.array(sceneLocalNpcStateSchema),
  recentTranscript: z.array(conversationTranscriptEntrySchema),
  compactedSummary: z.string().trim().min(1).optional(),
}).strict().superRefine((state, context) => {
  const ids = state.npcStates.map((item) => item.actorId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Conversation working state has duplicate NPC cognition",
      path: ["npcStates"],
    });
  }
});
export type ConversationWorkingState = z.infer<
  typeof conversationWorkingStateSchema
>;

export const communicationRecordPayloadSchema = z.object({
  act: communicationActSchema,
  recipientBeliefIds: z.array(stableIdSchema),
}).strict();

export const durableConversationConsequenceProposalSchema = z.object({
  mutation: jsonValueSchema,
  sourceEventIds: z.array(stableIdSchema).min(1),
  rationale: z.string().trim().min(1),
}).strict().superRefine((proposal, context) => {
  const parsed = mutationProposalSchema.safeParse(proposal.mutation);
  const allowed = new Set([
    "upsert-belief",
    "upsert-actor-goal",
    "upsert-actor-relationship",
    "upsert-actor-memory",
    "upsert-actor-commitment",
  ]);
  if (!parsed.success || !allowed.has(parsed.data.kind)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Conversation extraction may only propose existing belief/goal/relationship/memory/commitment mutations",
      path: ["mutation"],
    });
  }
});

export const durableConversationExtractionSchema = z.object({
  proposals: z.array(durableConversationConsequenceProposalSchema).max(8),
  compactedSummary: z.string().trim().min(1).optional(),
}).strict().superRefine((extraction, context) => {
  const memoryActors = extraction.proposals.flatMap((proposal) => {
    const parsed = mutationProposalSchema.safeParse(proposal.mutation);
    return parsed.success && parsed.data.kind === "upsert-actor-memory"
      ? [parsed.data.actorId]
      : [];
  });
  if (new Set(memoryActors).size !== memoryActors.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "One extraction may create at most one selective memory per actor",
      path: ["proposals"],
    });
  }
});
export type DurableConversationExtraction = z.infer<
  typeof durableConversationExtractionSchema
>;

export const narrationPreferenceSchema = z.enum([
  "concise",
  "standard",
  "expansive",
]);
export type NarrationPreference = z.infer<typeof narrationPreferenceSchema>;
export const narrationSizeBandSchema = z.enum(["small", "medium", "large"]);
export const conversationBeatComplexitySchema = z.enum([
  "terse",
  "ordinary",
  "complex",
]);

export const narrationTargetSchema = z.object({
  preference: narrationPreferenceSchema,
  band: narrationSizeBandSchema,
  minimumCharacters: z.number().int().nonnegative(),
  maximumCharacters: z.number().int().positive(),
  hardLimit: z.literal(false),
}).strict();
export type NarrationTarget = z.infer<typeof narrationTargetSchema>;

export const NARRATION_CHARACTER_TARGETS = Object.freeze({
  concise: Object.freeze({
    small: Object.freeze([80, 300] as const),
    medium: Object.freeze([300, 700] as const),
    large: Object.freeze([700, 1_200] as const),
  }),
  standard: Object.freeze({
    small: Object.freeze([120, 450] as const),
    medium: Object.freeze([450, 1_000] as const),
    large: Object.freeze([1_000, 1_800] as const),
  }),
  expansive: Object.freeze({
    small: Object.freeze([180, 600] as const),
    medium: Object.freeze([600, 1_400] as const),
    large: Object.freeze([1_400, 2_600] as const),
  }),
});

export const conversationTurnRequestSchema = z.object({
  turnId: stableIdSchema,
  interactionId: stableIdSchema,
  playerActorId: stableIdSchema,
  playerCharacterName: z.string().trim().min(1),
  recipientIds: z.array(stableIdSchema).min(1),
  materialNpcIds: z.array(stableIdSchema),
  declaration: z.string().trim().min(1),
  locationId: stableIdSchema.optional(),
  narrationPreference: narrationPreferenceSchema.default("standard"),
  beatComplexity: conversationBeatComplexitySchema.default("ordinary"),
  budget: contextBudgetSchema,
  authorizedMaterialSemanticKinds: z.array(
    materialCommunicationSemanticKindSchema,
  ),
  authorizedMaterialCommitments: z.array(z.string().trim().min(1)),
  authorizedDeception: z.boolean().default(false),
  authorizedTestimony: z.array(authorizedTestimonySchema),
  authorizedPlayerAction: playerActionRequestSchema.optional(),
  extractDurableConsequences: z.boolean().default(false),
}).strict();
export type ConversationTurnRequest = z.infer<
  typeof conversationTurnRequestSchema
>;
