import { z } from "zod";
import {
  contextQueryAuthorizationSchema,
  knowledgePerspectiveSchema,
} from "./context-contracts.js";
import {
  beliefHolderSchema,
  canonicalFactSchema,
  documentMetadataSchema,
  documentSectionSchema,
  jsonValueSchema,
} from "./content.js";
import type { GameDefinition } from "./contracts.js";
import { canonicalEventSchema, eventQuerySchema } from "./events.js";
import { stableIdSchema } from "./identity.js";
import {
  retrieveDocument,
  retrieveEventHistory,
  retrieveKnowledge,
  retrieveActorSocialState,
  RetrievalError,
} from "./retrieval.js";
import { actorSocialStateSchema } from "./actor-social-state.js";
import type {
  SourcedToolCatalogContribution,
  ToolCatalogContribution,
} from "./tool-catalog.js";

export const contextEngineIdentity = {
  id: "context-engine",
  version: "0.1.0",
} as const;

const knowledgeInputSchema = z
  .object({
    subjectId: stableIdSchema.optional(),
    tags: z.array(stableIdSchema).optional(),
  })
  .strict();

const retrievedBeliefSchema = z
  .object({
    id: stableIdSchema,
    holder: beliefHolderSchema,
    subjectId: stableIdSchema,
    proposition: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

const knowledgeOutputSchema = z
  .object({
    facts: z.array(canonicalFactSchema),
    beliefs: z.array(retrievedBeliefSchema),
  })
  .strict();

const documentRequestSchema = z.discriminatedUnion("level", [
  z.object({ level: z.literal("metadata") }).strict(),
  z.object({ level: z.literal("summary") }).strict(),
  z
    .object({ level: z.literal("section"), sectionId: stableIdSchema })
    .strict(),
  z.object({ level: z.literal("full") }).strict(),
]);

const documentInputSchema = z
  .object({ documentId: stableIdSchema, request: documentRequestSchema })
  .strict();

const documentOutputSchema = z.discriminatedUnion("level", [
  z
    .object({
      level: z.literal("metadata"),
      id: stableIdSchema,
      metadata: documentMetadataSchema,
    })
    .strict(),
  z
    .object({
      level: z.literal("summary"),
      id: stableIdSchema,
      metadata: documentMetadataSchema,
      summary: z.string().min(1),
      sections: z.array(documentSectionSchema.pick({ id: true, title: true, summary: true })),
    })
    .strict(),
  z
    .object({
      level: z.literal("section"),
      id: stableIdSchema,
      metadata: documentMetadataSchema,
      summary: z.string().min(1),
      section: documentSectionSchema,
    })
    .strict(),
  z
    .object({
      level: z.literal("full"),
      document: z
        .object({
          id: stableIdSchema,
          metadata: documentMetadataSchema,
          summary: z.string().min(1),
          sections: z.array(documentSectionSchema),
        })
        .strict(),
    })
    .strict(),
]);

const inspectEntityInputSchema = z.object({ localRef: stableIdSchema }).strict();
const inspectEntityOutputSchema = z
  .object({
    localRef: stableIdSchema,
    displayIdentity: z.string().min(1),
    detail: jsonValueSchema,
  })
  .strict();

const socialStateInputSchema = z.object({
  actorId: stableIdSchema.optional(),
}).strict();

const socialStateOutputSchema = actorSocialStateSchema.nullable();

const historyInputSchema = eventQuerySchema;

const retrievedEventSchema = canonicalEventSchema
  .omit({ relatedEntityIds: true })
  .extend({ relatedRefs: z.array(stableIdSchema) })
  .strict();

function requireAuthorization(value: unknown) {
  if (!value) throw new RetrievalError("Context authorization is required");
  const authorization = contextQueryAuthorizationSchema.parse(value);
  if (
    authorization.role === "actor" &&
    authorization.perspective.kind === "canonical"
  ) {
    throw new RetrievalError(
      "Actor queries require an actor or group knowledge perspective",
    );
  }
  return authorization;
}

function gameForRetrieval(game: GameDefinition) {
  return game as Parameters<typeof retrieveKnowledge>[0];
}

export function createContextToolCatalogContribution(
  game: GameDefinition,
): SourcedToolCatalogContribution {
  const contribution: ToolCatalogContribution = {
    domains: [
      {
        id: "knowledge",
        description: "Progressive, perspective-filtered access to current world knowledge and history.",
      },
    ],
    subsystems: [
      {
        id: "world",
        domainId: "knowledge",
        description: "Context-local scene references and focused entity detail.",
      },
      {
        id: "facts",
        domainId: "knowledge",
        description: "Canonical public facts and perspective-owned beliefs.",
      },
      {
        id: "social",
        domainId: "knowledge",
        description: "Perspective-safe persistent goals, relationships, memories, and commitments for one actor.",
      },
      {
        id: "history",
        domainId: "knowledge",
        description: "Bounded, filtered meaningful event history.",
      },
      {
        id: "documents",
        domainId: "knowledge",
        description: "Progressive metadata, summary, section, and full-document retrieval.",
      },
    ],
    queries: [
      {
        id: "knowledge.world.inspect-entity",
        description: "Expand one authorized context-local scene reference without exposing its canonical identity.",
        domainId: "knowledge",
        subsystemId: "world",
        inputSchema: inspectEntityInputSchema,
        outputSchema: inspectEntityOutputSchema,
        query(context, input) {
          requireAuthorization(context.authorization);
          const canonicalId = context.localReferences[input.localRef];
          const displayIdentity = context.localDisplays[input.localRef];
          const detail = context.localDetails[input.localRef];
          if (!canonicalId || !displayIdentity || detail === undefined) {
            throw new RetrievalError("Scene reference is unavailable to this context");
          }
          if (!context.world.entities.some((entity) => entity.id === canonicalId)) {
            throw new RetrievalError("Scene reference is stale");
          }
          return { localRef: input.localRef, displayIdentity, detail };
        },
      },
      {
        id: "knowledge.facts.retrieve",
        description: "Retrieve public facts and the selected actor/group's beliefs without belief truth status.",
        domainId: "knowledge",
        subsystemId: "facts",
        inputSchema: knowledgeInputSchema,
        outputSchema: knowledgeOutputSchema,
        query(context, input) {
          const authorization = requireAuthorization(context.authorization);
          const privileged = authorization.role === "orchestrator" ||
            authorization.role === "planner" ||
            authorization.role === "debug";
          const perspective = knowledgePerspectiveSchema.parse(
            privileged && (input.subjectId || authorization.role === "debug")
              ? { kind: "canonical" }
              : authorization.perspective,
          );
          return retrieveKnowledge(
            gameForRetrieval(game),
            context.world as Parameters<typeof retrieveKnowledge>[1],
            perspective,
            input,
          );
        },
      },
      {
        id: "knowledge.social.retrieve",
        description: "Retrieve one actor's persistent social state. Actor-role callers may retrieve only their own state.",
        domainId: "knowledge",
        subsystemId: "social",
        inputSchema: socialStateInputSchema,
        outputSchema: socialStateOutputSchema,
        query(context, input) {
          const authorization = requireAuthorization(context.authorization);
          const privileged = authorization.role === "orchestrator" ||
            authorization.role === "planner" ||
            authorization.role === "debug";
          let actorId: string;
          if (privileged) {
            actorId = input.actorId ??
              (authorization.perspective.kind === "actor"
                ? authorization.perspective.id
                : "");
          } else {
            if (authorization.perspective.kind !== "actor") {
              throw new RetrievalError(
                "Actor social-state retrieval requires an actor perspective",
              );
            }
            actorId = authorization.perspective.id;
            if (input.actorId && input.actorId !== actorId) {
              throw new RetrievalError(
                "Actor-role callers may retrieve only their own social state",
              );
            }
          }
          if (!actorId) {
            throw new RetrievalError("An actor ID is required for social-state retrieval");
          }
          if (!context.world.entities.some((entity) => entity.id === actorId)) {
            throw new RetrievalError(`Unknown actor: ${actorId}`);
          }
          return retrieveActorSocialState(
            context.world as Parameters<typeof retrieveActorSocialState>[0],
            actorId,
          ) ?? null;
        },
      },
      {
        id: "knowledge.history.retrieve",
        description: "Retrieve bounded event history filtered by role, perspective, entity, scope, type, and time.",
        domainId: "knowledge",
        subsystemId: "history",
        inputSchema: historyInputSchema,
        outputSchema: z.array(retrievedEventSchema),
        async query(context, input) {
          const authorization = requireAuthorization(context.authorization);
          if (!context.history || !context.worldId) {
            throw new RetrievalError("Event history access is unavailable");
          }
          if (
            authorization.role !== "debug" &&
            !input.from && !input.to && !input.types &&
            !input.relatedEntityId && !input.scopeId &&
            !input.causedByEventId && !input.originKind && !input.originId
          ) {
            throw new RetrievalError(
              "History retrieval requires a bounded entity, scope, type, origin, cause, or time filter",
            );
          }
          return retrieveEventHistory(context.history, context.worldId, {
            role: authorization.role,
            perspective: authorization.perspective,
            query: input,
            localReferences: context.localReferences,
          });
        },
      },
      {
        id: "knowledge.documents.retrieve",
        description: "Retrieve an authorized document progressively from metadata through full content.",
        domainId: "knowledge",
        subsystemId: "documents",
        inputSchema: documentInputSchema,
        outputSchema: documentOutputSchema,
        query(context, input) {
          const authorization = requireAuthorization(context.authorization);
          return retrieveDocument(
            gameForRetrieval(game),
            context.world as Parameters<typeof retrieveDocument>[1],
            authorization.perspective,
            input.documentId,
            input.request,
          );
        },
      },
    ],
  };
  return { sourceComponent: contextEngineIdentity, contribution };
}
