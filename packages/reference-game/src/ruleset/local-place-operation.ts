import {
  canonicalFactSchema,
  entitySchema,
  fictionalDurationMs,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type MutationProposal,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";

export const enterLocalPlaceInputSchema = z.object({
  actorId: stableIdSchema,
  placeName: z.string().trim().min(1).max(120),
  /** Stable prior source identity when entering an authored location hint. */
  sourceFactId: stableIdSchema.optional(),
  travelDurationMs: z.number().int().nonnegative().max(60 * 60_000),
}).strict();

export const enterLocalPlaceResultSchema = z.object({
  actorId: stableIdSchema,
  fromLocationId: stableIdSchema,
  toLocationId: stableIdSchema,
  placeName: z.string().trim().min(1),
  created: z.boolean(),
}).strict();

export const localPlaceEnteredEventType: EventTypeDefinition<
  z.infer<typeof enterLocalPlaceResultSchema>
> = {
  type: "rules.local-place-entered",
  schemaVersion: 1,
  payloadSchema: enterLocalPlaceResultSchema,
};

function normalizedPlaceName(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function placeSlug(value: string): string {
  const slug = value
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "local-place";
}

export const enterLocalPlaceOperation: RulesOperation<
  z.infer<typeof enterLocalPlaceInputSchema>,
  z.infer<typeof enterLocalPlaceResultSchema>
> = {
  metadata: {
    id: "rules.actions.enter-local-place",
    kind: "ordinary",
    retentionClass: "canonical",
    description:
      "Move an actor from their current broad location into a specifically named nearby place, room, facility, or area, creating that nested location canonically when first visited.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["movement", "location", "world-state"],
    },
    applicability: { actionModes: ["movement"] },
  },
  inputSchema: enterLocalPlaceInputSchema,
  outputSchema: enterLocalPlaceResultSchema,
  execute(context, input) {
    const actor = context.world.entities.find((item) => item.id === input.actorId);
    if (!actor || actor.kind !== "actor") {
      throw new OperationValidationError(`Missing actor ${input.actorId}`);
    }
    const currentLocationValue = [...context.world.facts].reverse().find((item) =>
      item.subjectId === input.actorId &&
      item.predicate === "actor.current-location" &&
      typeof item.value === "string"
    )?.value ?? actor.data.currentLocation;
    if (typeof currentLocationValue !== "string") {
      throw new OperationValidationError(
        `Actor ${input.actorId} has no canonical current location`,
      );
    }
    const parent = context.world.entities.find((item) => item.id === currentLocationValue);
    const parentContext = parent?.data.context;
    const parentContextLocationId = parentContext &&
      typeof parentContext === "object" &&
      !Array.isArray(parentContext)
      ? (parentContext as Readonly<Record<string, unknown>>).locationId
      : undefined;
    const isSceneContainer = parentContextLocationId === currentLocationValue;
    if (!parent || (parent.kind !== "location" && !isSceneContainer)) {
      throw new OperationValidationError(
        `Current location ${currentLocationValue} is not a canonical scene container`,
      );
    }

    const normalizedName = normalizedPlaceName(input.placeName);
    const sourceFact = input.sourceFactId
      ? context.world.facts.find((fact) => fact.id === input.sourceFactId)
      : undefined;
    const sourceValue = sourceFact?.value;
    const sourceName = sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue)
      ? (sourceValue as Readonly<Record<string, unknown>>).name : undefined;
    const immediateParent = typeof parent.data.parentLocationId === "string"
      ? parent.data.parentLocationId : undefined;
    if (input.sourceFactId && (
      !sourceFact || sourceFact.predicate !== "location.hint" ||
      sourceFact.visibility !== "public" ||
      (sourceFact.subjectId !== currentLocationValue && sourceFact.subjectId !== immediateParent) ||
      typeof sourceName !== "string" ||
      normalizedPlaceName(sourceName) !== normalizedName
    )) throw new OperationValidationError("Canonical location hint does not authorize this named entry");
    // Re-entering the exact room where the actor already stands must not
    // manufacture a nested duplicate or a spurious location-change event.
    if (
      parent.kind === "location" &&
      (normalizedPlaceName(
        typeof parent.data.localPlaceName === "string"
          ? parent.data.localPlaceName
          : parent.name,
      ) === normalizedName) &&
      (!input.sourceFactId ||
        parent.data["location-source-fact-id"] === input.sourceFactId)
    ) {
      const result = enterLocalPlaceResultSchema.parse({
        actorId: input.actorId,
        fromLocationId: currentLocationValue,
        toLocationId: currentLocationValue,
        placeName: input.placeName,
        created: false,
      });
      return {
        result,
        advanceTimeByMs: fictionalDurationMs(0),
        proposedMutations: [],
        proposedEvents: [],
      };
    }
    const parentOfCurrent = typeof parent.data.parentLocationId === "string"
      ? parent.data.parentLocationId : undefined;
    const candidates = context.world.entities.filter((item) =>
      item.kind === "location" &&
      typeof item.data.localPlaceName === "string" &&
      normalizedPlaceName(item.data.localPlaceName) === normalizedName
    );
    // Reuse an exact canonical child first, then a known sibling. A shared
    // display name in a different parent scope is NOT the same place.
    const existing = input.sourceFactId
      ? candidates.find((item) =>
          item.data["location-source-fact-id"] === input.sourceFactId &&
          (item.data.parentLocationId === currentLocationValue ||
            item.data.parentLocationId === parentOfCurrent))
      : candidates.find((item) =>
          item.data.parentLocationId === currentLocationValue &&
          item.data["location-source-fact-id"] === undefined
        ) ?? (parentOfCurrent ? candidates.find((item) =>
          item.data.parentLocationId === parentOfCurrent &&
          item.data["location-source-fact-id"] === undefined
        ) : undefined);
    let toLocationId = existing?.id;
    if (!toLocationId) {
      const base = `${currentLocationValue}.place.${placeSlug(input.placeName)}`;
      toLocationId = base;
      let suffix = 2;
      while (context.world.entities.some((item) => item.id === toLocationId)) {
        toLocationId = `${base}-${suffix}`;
        suffix += 1;
      }
    }

    const created = !existing;
    const result = enterLocalPlaceResultSchema.parse({
      actorId: input.actorId,
      fromLocationId: currentLocationValue,
      toLocationId,
      placeName: input.placeName,
      created,
    });
    const proposedMutations: MutationProposal[] = [];
    if (created) {
      proposedMutations.push({
        kind: "add-entity" as const,
        entity: entitySchema.parse({
          id: toLocationId,
          kind: "location",
          name: input.placeName,
          summary: sourceValue && typeof sourceValue === "object" && !Array.isArray(sourceValue) &&
              typeof (sourceValue as Readonly<Record<string, unknown>>).summary === "string"
              ? (sourceValue as Readonly<Record<string, string>>).summary
              : `${input.placeName} is a specific place within ${parent.name}.`,
          data: {
            parentLocationId: currentLocationValue,
            ...(input.sourceFactId ? { "location-source-fact-id": input.sourceFactId } : {}),
            localPlaceName: input.placeName,
            generatedLocalPlace: true,
            context: {
              locationId: toLocationId,
              category: "feature",
              prominence: "prominent",
              observable: true,
              activeParticipant: false,
              orchestratorVisible: true,
              knownBy: [{ kind: "actor", id: input.actorId }],
              identities: [],
            },
          },
        }),
      });
      proposedMutations.push({
        kind: "upsert-fact" as const,
        fact: canonicalFactSchema.parse({
          id: `state.fact.parent.${toLocationId}`,
          subjectId: toLocationId,
          predicate: "location.parent",
          value: currentLocationValue,
          visibility: "public",
          tags: ["location", "hierarchy"],
        }),
      });
    }
    // New and revisited nested places require a stable traversable route,
    // but a revisit must never duplicate or rewrite an existing route.
    const actualParentId = existing && typeof existing.data.parentLocationId === "string"
      ? existing.data.parentLocationId : currentLocationValue;
    const routeId = `state.fact.route.${toLocationId}`;
    if (!context.world.facts.some((fact) => fact.id === routeId)) {
      proposedMutations.push({
        kind: "upsert-fact",
        fact: canonicalFactSchema.parse({
          id: routeId,
          subjectId: toLocationId,
          predicate: "location.route",
          value: {
            fromId: actualParentId, toId: toLocationId,
            summary: `Ordinary accessible passage between the parent place and ${input.placeName}.`,
            traversable: true, bidirectional: true,
          },
          visibility: "public",
          tags: ["location", "route"],
        }),
      });
    }
    proposedMutations.push({
      kind: "upsert-fact" as const,
      fact: canonicalFactSchema.parse({
        id: `state.fact.location.${input.actorId}`,
        subjectId: input.actorId,
        predicate: "actor.current-location",
        value: toLocationId,
        visibility: "public",
        tags: ["location", "movement"],
      }),
    });

    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.travelDurationMs),
      proposedMutations,
      proposedEvents: [{
        type: "rules.local-place-entered",
        schemaVersion: 1,
        summary: `${actor.name} entered ${input.placeName} within ${parent.name}.`,
        relatedEntityIds: [input.actorId, currentLocationValue, toLocationId],
        scopeIds: [currentLocationValue, toLocationId],
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.actions.enter-local-place",
        },
        payload: result,
        access: "public",
      }],
    };
  },
};
