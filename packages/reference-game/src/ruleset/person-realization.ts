import { z } from "zod";
import {
  entitySchema, fictionalDurationMs, jsonValueSchema,
  OperationValidationError, stableIdSchema,
  type EventTypeDefinition, type MutationProposal, type RulesOperation,
} from "@llm-ttrpg/engine";
import {
  densifyGeneratedEntity, promoteObservedPerson,
} from "../starting-region.js";

/** An observation must be committed independently before promotion. A name
 * appearing in narration is not a valid person source. */
const observedPersonFactValueSchema = z.object({
  label: z.string().trim().min(1).max(100),
  summary: z.string().trim().min(1).max(300),
  disclosedName: z.string().trim().min(1).max(100).optional(),
}).strict();

export const realizeObservedPersonInputSchema = z.object({
  observationFactId: stableIdSchema,
  locationId: stableIdSchema,
  actorId: stableIdSchema,
  targetLevel: z.enum(["ephemeral", "identified", "persistent"]),
  occurredAt: z.string().datetime(),
}).strict();
export const realizeObservedPersonResultSchema = z.object({
  entityId: stableIdSchema,
  observationFactId: stableIdSchema,
  resolution: z.enum(["ephemeral", "identified", "persistent"]),
  created: z.boolean(),
}).strict();
export const personRealizedEventType: EventTypeDefinition<
  z.infer<typeof realizeObservedPersonResultSchema>
> = {
  type: "rules.person-realized", schemaVersion: 1,
  payloadSchema: realizeObservedPersonResultSchema,
};
const ranks = { ephemeral: 1, identified: 2, persistent: 3 } as const;

function sourceEntityId(observationId: string): string {
  // Stable across reloads and independent of display names; two distinct
  // people with the same name never accidentally merge.
  let hash = 2166136261;
  for (let i = 0; i < observationId.length; i++) {
    hash ^= observationId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `generated.actor.observed-${(hash >>> 0).toString(16)}`;
}

export const realizeObservedPersonOperation: RulesOperation<
  z.infer<typeof realizeObservedPersonInputSchema>,
  z.infer<typeof realizeObservedPersonResultSchema>
> = {
  metadata: {
    id: "rules.realization.realize-observed-person",
    kind: "ordinary",
    retentionClass: "canonical",
    description: "Promote a previously committed local person observation only when a real encounter requires stable identity.",
    category: { domain: { id: "rules", label: "Rules" },
      subsystem: { id: "realization", label: "Mechanical Realization" },
      tags: ["realization", "identity"] },
  },
  inputSchema: realizeObservedPersonInputSchema,
  outputSchema: realizeObservedPersonResultSchema,
  execute({ world }, input) {
    const fact = world.facts.find((item) => item.id === input.observationFactId);
    if (!fact || fact.predicate !== "person.observed" ||
        fact.subjectId !== input.locationId || fact.visibility !== "public") {
      throw new OperationValidationError("Person identity requires an accessible, canonical local observation fact");
    }
    const actor = world.entities.find((entity) => entity.id === input.actorId);
    const location = world.entities.find((entity) => entity.id === input.locationId);
    if (!actor || actor.kind !== "actor" || !location || location.kind !== "location") {
      throw new OperationValidationError("Person observation requires a canonical actor and location");
    }
    const observed = observedPersonFactValueSchema.parse(fact.value);
    const existing = world.entities.find((entry) =>
      entry.data["observation-source-id"] === fact.id &&
      entry.data["observation-scope-id"] === fact.subjectId
    );
    const id = existing?.id ?? sourceEntityId(fact.id);
    if (!existing && world.entities.some((entry) => entry.id === id)) {
      throw new OperationValidationError("Observed person ID collided with an unrelated canonical entity");
    }
    const history = existing?.data["identity-resolution-history"];
    const priorSteps = Array.isArray(history) ? history : [];
    const priorLevel = priorSteps.length > 0
      ? (priorSteps[priorSteps.length - 1] as { level?: string })?.level
      : undefined;
    const previousRank = priorLevel === "persistent" ? 3 :
      priorLevel === "identified" ? 2 : priorLevel === "ephemeral" ? 1 : 0;
    const already = previousRank >= ranks[input.targetLevel];
    const result = realizeObservedPersonResultSchema.parse({
      entityId: id, observationFactId: fact.id,
      resolution: already ? priorLevel : input.targetLevel,
      created: !existing,
    });
    if (already) return { result: { ...result, created: false },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [], proposedEvents: [] };

    const source = {
      class: "simulation-derived" as const, sourceIds: [fact.id],
      rationale: "Identity can extend only the committed scene observation.",
    };
    const step = {
      id: `resolution.${id}.${input.targetLevel}`,
      level: input.targetLevel, establishedAt: input.occurredAt,
      provenance: source,
    };
    const data: Record<string, z.infer<typeof jsonValueSchema>> = {
      "observation-source-id": fact.id,
      "observation-scope-id": fact.subjectId,
      "observation-summary": observed.summary,
      "identity-resolution-history": jsonValueSchema.parse([...priorSteps, step]),
      ...(observed.disclosedName ? { "known-as": observed.disclosedName } : {}),
    };
    let mutations: MutationProposal[];
    if (existing) {
      const extended = densifyGeneratedEntity(existing, {
        entityId: id,
        candidateData: { ...existing.data, ...data },
        requiredPaths: ["identity-resolution-history"],
        provenance: { class: "later-densification",
          sourceIds: [fact.id], rationale: "A consequential encounter increased identity specificity." },
      });
      mutations = [...extended.mutations];
    } else if (input.targetLevel === "ephemeral") {
      mutations = [{ kind: "add-entity", entity: entitySchema.parse({
        id, kind: "actor", name: observed.label, summary: observed.summary, data,
      }) }];
    } else {
      // Reuse the source-checked promotion path for a directly identified
      // observation. Its resolution history preserves the observation.
      const promotion = promoteObservedPerson({
        id: fact.id, summary: observed.summary, resolution: "ephemeral",
        establishedData: data, provenance: source,
      }, {
        entity: entitySchema.parse({
          id, kind: "actor",
          name: observed.disclosedName ?? observed.label, summary: observed.summary, data,
        }),
        targetResolution: input.targetLevel,
        resolutionStep: step,
        ...(input.targetLevel === "persistent" ? {
          socialState: { actorId: id, goals: [], relationships: [],
            memories: [], commitments: [] },
        } : {}),
      });
      mutations = [...promotion.mutations];
    }
    if (input.targetLevel === "persistent" && existing &&
        !world.actorSocialStates.some((state) => state.actorId === id)) {
      mutations.push({ kind: "ensure-actor-social-state", actorId: id });
    }
    const updated = { ...result, created: !existing };
    return {
      result: updated, advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: mutations,
      proposedEvents: [{
        type: "rules.person-realized", schemaVersion: 1,
        summary: `A previously observed local person is now ${input.targetLevel}.`,
        relatedEntityIds: [id, input.locationId, input.actorId],
        scopeIds: [input.locationId],
        causedByEventIds: [],
        origin: { kind: "rules-operation", id: "rules.realization.realize-observed-person" },
        payload: updated, access: "gm-only",
      }],
    };
  },
};
