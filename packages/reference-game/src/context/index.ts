import {
  sceneSourceElementSchema,
  type SceneSourceProvider,
} from "@llm-ttrpg/engine";
import { z } from "zod";

const referenceSceneMetadataSchema = z
  .object({
    locationId: z.string().min(1),
    category: z.enum(["participant", "object", "feature", "condition", "other"]),
    prominence: z.enum(["prominent", "ambient"]),
    unrecognizedIdentity: z.string().min(1).optional(),
    observable: z.boolean().default(true),
    activeParticipant: z.boolean().default(false),
    orchestratorVisible: z.boolean().default(false),
    knownBy: z
      .array(
        z.object({ kind: z.enum(["actor", "group"]), id: z.string().min(1) }).strict(),
      )
      .default([]),
    identities: z
      .array(
        z
          .object({
            holder: z.object({ kind: z.enum(["actor", "group"]), id: z.string().min(1) }).strict(),
            displayIdentity: z.string().min(1),
            recognized: z.boolean(),
          })
          .strict(),
      )
      .default([]),
    coarseState: z.unknown().optional(),
    detail: z.unknown().optional(),
    privilegedDetail: z.unknown().optional(),
    discovery: z
      .object({
        status: z.enum([
          "discoverable-now",
          "conditionally-discoverable",
          "not-currently-discoverable",
        ]),
        guidance: z.string().min(1).optional(),
        capabilityIds: z.array(z.string().min(1)).default([]),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Reference-game projection over its opaque entity data. The engine validates
 * and access-filters the result; this package decides how its own content marks
 * location, observability, and descriptive identity.
 */
export const referenceSceneSource: SceneSourceProvider = {
  derive(world, request) {
    return world.entities.flatMap((entity) => {
      const parsed = referenceSceneMetadataSchema.safeParse(entity.data.context);
      if (!parsed.success) return [];
      const context = parsed.data;
      const activeInteraction = Boolean(
        request.workingContext?.activeEntityIds.includes(entity.id) ||
        request.workingContext?.currentConversationEntityId === entity.id ||
        request.workingContext?.inspectedEntityId === entity.id,
      );
      return [sceneSourceElementSchema.parse({
        canonicalEntityId: entity.id,
        locationId: context.locationId,
        displayIdentity: entity.name,
        ...(context.unrecognizedIdentity
          ? { unrecognizedIdentity: context.unrecognizedIdentity }
          : {}),
        identities: context.identities,
        category: context.category,
        prominence: context.prominence,
        summary: entity.summary,
        ...(context.coarseState !== undefined
          ? { coarseState: context.coarseState }
          : {}),
        ...(context.detail !== undefined ? { detail: context.detail } : {}),
        ...(context.privilegedDetail !== undefined
          ? { privilegedDetail: context.privilegedDetail }
          : {}),
        observable: context.observable,
        activeParticipant: context.activeParticipant,
        activeInteraction,
        knownBy: context.knownBy,
        orchestratorVisible: context.orchestratorVisible,
        ...(context.discovery ? { discovery: context.discovery } : {}),
        sourceKind: "entity",
        sourceIds: [entity.id],
      })];
    });
  },
};
