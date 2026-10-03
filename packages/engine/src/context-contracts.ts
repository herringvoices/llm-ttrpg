import { z } from "zod";
import { executableIntentSchema } from "./action-pressure.js";
import { gameCompositionSchema } from "./save.js";
import { stableIdSchema } from "./identity.js";
import { jsonValueSchema } from "./json.js";
import { fictionalInstantSchema } from "./time.js";

export const modelRoleSchema = z.enum([
  "actor",
  "orchestrator",
  "planner",
  "debug",
]);
export type ModelRole = z.infer<typeof modelRoleSchema>;

export const knowledgePerspectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("canonical") }).strict(),
  z
    .object({ kind: z.enum(["actor", "group"]), id: stableIdSchema })
    .strict(),
]);
export type KnowledgePerspective = z.infer<typeof knowledgePerspectiveSchema>;

export const contextQueryAuthorizationSchema = z
  .object({
    role: modelRoleSchema,
    perspective: knowledgePerspectiveSchema,
    focalActorId: stableIdSchema.optional(),
  })
  .strict();
export type ContextQueryAuthorization = z.infer<
  typeof contextQueryAuthorizationSchema
>;

export const contextBudgetSchema = z
  .object({ maxUnits: z.number().int().positive() })
  .strict();
export type ContextBudget = z.infer<typeof contextBudgetSchema>;

export const workingContextSchema = z
  .object({
    interactionId: stableIdSchema.optional(),
    currentConversationEntityId: stableIdSchema.optional(),
    inspectedEntityId: stableIdSchema.optional(),
    activeEntityIds: z.array(stableIdSchema).default([]),
    recentEntityIds: z.array(stableIdSchema).default([]),
    aliases: z
      .array(
        z
          .object({ alias: z.string().trim().min(1), entityId: stableIdSchema })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type WorkingContext = z.infer<typeof workingContextSchema>;

export const contextAssemblyRequestSchema = z
  .object({
    role: modelRoleSchema,
    perspective: knowledgePerspectiveSchema,
    focalActorId: stableIdSchema.optional(),
    locationId: stableIdSchema.optional(),
    declaration: z.string().trim().min(1).optional(),
    executableIntent: executableIntentSchema.optional(),
    workingContext: workingContextSchema.optional(),
    budget: contextBudgetSchema,
  })
  .strict();
export type ContextAssemblyRequest = z.infer<
  typeof contextAssemblyRequestSchema
>;

export const sceneElementCategorySchema = z.enum([
  "participant",
  "object",
  "feature",
  "condition",
  "other",
]);
export type SceneElementCategory = z.infer<
  typeof sceneElementCategorySchema
>;

export const sceneProminenceSchema = z.enum([
  "prominent",
  "ambient",
  "latent",
]);
export type SceneProminence = z.infer<typeof sceneProminenceSchema>;

const perspectiveIdentitySchema = z
  .object({
    holder: z
      .object({ kind: z.enum(["actor", "group"]), id: stableIdSchema })
      .strict(),
    displayIdentity: z.string().min(1),
    recognized: z.boolean(),
  })
  .strict();

export const discoveryStatusSchema = z.enum([
  "discoverable-now",
  "conditionally-discoverable",
  "not-currently-discoverable",
]);
export type DiscoveryStatus = z.infer<typeof discoveryStatusSchema>;

export const sceneSourceElementSchema = z
  .object({
    canonicalEntityId: stableIdSchema,
    locationId: stableIdSchema.optional(),
    displayIdentity: z.string().min(1),
    unrecognizedIdentity: z.string().min(1).optional(),
    identities: z.array(perspectiveIdentitySchema).default([]),
    category: sceneElementCategorySchema,
    prominence: z.enum(["prominent", "ambient"]),
    summary: z.string().min(1).optional(),
    coarseState: jsonValueSchema.optional(),
    detail: jsonValueSchema.optional(),
    privilegedDetail: jsonValueSchema.optional(),
    observable: z.boolean().default(true),
    activeParticipant: z.boolean().default(false),
    activeInteraction: z.boolean().default(false),
    knownBy: z
      .array(
        z
          .object({ kind: z.enum(["actor", "group"]), id: stableIdSchema })
          .strict(),
      )
      .default([]),
    orchestratorVisible: z.boolean().default(false),
    discovery: z
      .object({
        status: discoveryStatusSchema,
        guidance: z.string().min(1).optional(),
        capabilityIds: z.array(stableIdSchema).default([]),
      })
      .strict()
      .optional(),
    sourceKind: z.enum(["entity", "fact", "working-context"]),
    sourceIds: z.array(stableIdSchema).min(1),
  })
  .strict();
export type SceneSourceElement = z.infer<typeof sceneSourceElementSchema>;

export const contextAccessSchema = z
  .object({
    audience: z.array(modelRoleSchema).min(1),
    perspective: knowledgePerspectiveSchema,
    actorAware: z.boolean(),
    identityRecognized: z.boolean(),
    privileged: z.boolean(),
    discoveryStatus: discoveryStatusSchema.optional(),
  })
  .strict();
export type ContextAccess = z.infer<typeof contextAccessSchema>;

export const projectedExecutableIntentSchema = executableIntentSchema
  .omit({ actorId: true, targetIds: true })
  .extend({
    actorRef: stableIdSchema.optional(),
    targetRefs: z.array(stableIdSchema),
  })
  .strict();
export type ProjectedExecutableIntent = z.infer<
  typeof projectedExecutableIntentSchema
>;

export const contextProvenanceSchema = z
  .object({
    sourceKind: z.enum([
      "bootstrap",
      "entity",
      "fact",
      "belief",
      "event",
      "document",
      "working-context",
      "plan",
      "tool-catalog",
      "tool-result",
    ]),
    sourceIds: z.array(stableIdSchema),
    component: z
      .object({ id: stableIdSchema, version: z.string().min(1) })
      .strict()
      .optional(),
    worldRevision: z.number().int().nonnegative().optional(),
  })
  .strict();
export type ContextProvenance = z.infer<typeof contextProvenanceSchema>;

export const sceneElementSchema = z
  .object({
    localRef: stableIdSchema,
    displayIdentity: z.string().min(1),
    category: sceneElementCategorySchema,
    prominence: sceneProminenceSchema,
    summary: z.string().min(1).optional(),
    coarseState: jsonValueSchema.optional(),
    activeParticipant: z.boolean(),
    activeInteraction: z.boolean(),
    access: contextAccessSchema,
  })
  .strict();
export type SceneElement = z.infer<typeof sceneElementSchema>;

export const contextItemSchema = z
  .object({
    localId: stableIdSchema,
    kind: stableIdSchema,
    salience: z.enum(["required", "prominent", "ambient", "retrieved"]),
    content: jsonValueSchema,
    provenance: contextProvenanceSchema,
    access: contextAccessSchema,
    derivation: z.enum(["raw", "projected", "summarized"]),
    relevance: z.number().int().min(0).max(100).default(50),
  })
  .strict();
export type ContextItem = z.infer<typeof contextItemSchema>;

export const bootstrapContextSchema = z
  .object({
    authority: z.array(z.string().min(1)).min(1),
    composition: gameCompositionSchema,
    role: modelRoleSchema,
    perspective: knowledgePerspectiveSchema,
    discoveryProtocol: z.array(z.string().min(1)).min(1),
  })
  .strict();
export type BootstrapContext = z.infer<typeof bootstrapContextSchema>;

export const situationContextSchema = z
  .object({
    role: modelRoleSchema,
    perspective: knowledgePerspectiveSchema,
    focalActorRef: stableIdSchema.optional(),
    fictionalTime: fictionalInstantSchema,
    locationRef: stableIdSchema.optional(),
    actionPressure: jsonValueSchema,
    declaration: z.string().min(1).optional(),
    executableIntent: projectedExecutableIntentSchema.optional(),
    scene: z.array(sceneElementSchema),
    working: z
      .object({
        interactionId: stableIdSchema.optional(),
        activeRefs: z.array(stableIdSchema),
        recentRefs: z.array(stableIdSchema),
        aliases: z.record(stableIdSchema),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SituationContext = z.infer<typeof situationContextSchema>;

export const contextDiagnosticSchema = z
  .object({
    localId: stableIdSchema,
    decision: z.enum(["included", "omitted", "compressed"]),
    reason: z.string().min(1),
    estimatedUnits: z.number().int().nonnegative(),
    provenance: contextProvenanceSchema.optional(),
    canonicalEntityId: stableIdSchema.optional(),
  })
  .strict();
export type ContextDiagnostic = z.infer<typeof contextDiagnosticSchema>;

export const contextPackageSchema = z
  .object({
    bootstrap: bootstrapContextSchema,
    situation: situationContextSchema,
    retrieved: z.array(contextItemSchema),
    discovery: z
      .object({
        domains: z.array(
          z.object({ id: stableIdSchema, description: z.string().min(1) }).strict(),
        ),
        omittedInformationIsUnknown: z.literal(true),
      })
      .strict(),
    diagnostics: z
      .object({
        worldRevision: z.number().int().nonnegative(),
        eventSequence: z.number().int().nonnegative().optional(),
        budget: contextBudgetSchema,
        usedUnits: z.number().int().nonnegative(),
        requiredUnits: z.number().int().nonnegative(),
        overBudget: z.boolean(),
        decisions: z.array(contextDiagnosticSchema),
        localReferences: z.record(stableIdSchema),
      })
      .strict(),
  })
  .strict();
export type ContextPackage = z.infer<typeof contextPackageSchema>;
