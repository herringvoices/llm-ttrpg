import {
  canonicalFactSchema,
  fictionalDurationMs,
  OperationValidationError,
  stableIdSchema,
  type EventTypeDefinition,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import { z } from "zod";

const routeValueSchema = z.object({
  fromId: stableIdSchema,
  toId: stableIdSchema,
  summary: z.string().trim().min(1),
  traversable: z.literal(true),
  bidirectional: z.boolean(),
}).strict();

export const traverseRouteInputSchema = z.object({
  actorId: stableIdSchema,
  routeFactId: stableIdSchema,
  fromLocationId: stableIdSchema,
  toLocationId: stableIdSchema,
  travelDurationMs: z.number().int().nonnegative(),
  scopeIds: z.array(stableIdSchema),
}).strict();

export const traverseRouteResultSchema = z.object({
  actorId: stableIdSchema,
  fromLocationId: stableIdSchema,
  toLocationId: stableIdSchema,
  routeFactId: stableIdSchema,
}).strict();

export const routeTraversedEventType: EventTypeDefinition<
  z.infer<typeof traverseRouteResultSchema>
> = {
  type: "rules.route-traversed",
  schemaVersion: 1,
  payloadSchema: traverseRouteResultSchema,
};

export const traverseRouteOperation: RulesOperation<
  z.infer<typeof traverseRouteInputSchema>,
  z.infer<typeof traverseRouteResultSchema>
> = {
  metadata: {
    id: "rules.actions.traverse-route",
    kind: "ordinary",
    description:
      "Move an actor through an ordinary canonical route without knowing what kind of location the route connects.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["movement", "route", "world-state"],
    },
  },
  inputSchema: traverseRouteInputSchema,
  outputSchema: traverseRouteResultSchema,
  execute(context, input) {
    const actor = context.world.entities.find((item) => item.id === input.actorId);
    if (!actor) throw new OperationValidationError(`Missing actor ${input.actorId}`);
    const currentLocationFact = context.world.facts.find((item) =>
      item.subjectId === input.actorId &&
      item.predicate === "actor.current-location" &&
      typeof item.value === "string"
    );
    const currentLocation = currentLocationFact?.value ?? actor.data.currentLocation;
    if (currentLocation !== input.fromLocationId) {
      throw new OperationValidationError(
        `Actor ${input.actorId} is not at ${input.fromLocationId}`,
      );
    }
    const routeFact = context.world.facts.find((item) =>
      item.id === input.routeFactId
    );
    if (!routeFact || routeFact.predicate !== "location.route") {
      throw new OperationValidationError(
        `Missing canonical route fact ${input.routeFactId}`,
      );
    }
    const route = routeValueSchema.parse(routeFact.value);
    const forward = route.fromId === input.fromLocationId &&
      route.toId === input.toLocationId;
    const reverse = route.bidirectional &&
      route.toId === input.fromLocationId &&
      route.fromId === input.toLocationId;
    if (!forward && !reverse) {
      throw new OperationValidationError(
        `Route ${input.routeFactId} does not connect the requested locations`,
      );
    }
    const result = traverseRouteResultSchema.parse({
      actorId: input.actorId,
      fromLocationId: input.fromLocationId,
      toLocationId: input.toLocationId,
      routeFactId: input.routeFactId,
    });
    return {
      result,
      advanceTimeByMs: fictionalDurationMs(input.travelDurationMs),
      proposedMutations: [
        {
          kind: "upsert-fact",
          fact: canonicalFactSchema.parse({
            id: `state.fact.location.${input.actorId}`,
            subjectId: input.actorId,
            predicate: "actor.current-location",
            value: input.toLocationId,
            visibility: "public",
            tags: ["location", "movement"],
          }),
        },
      ],
      proposedEvents: [{
        type: "rules.route-traversed",
        schemaVersion: 1,
        summary: `${input.actorId} traveled from ${input.fromLocationId} to ${input.toLocationId}.`,
        relatedEntityIds: [
          input.actorId,
          input.fromLocationId,
          input.toLocationId,
        ],
        scopeIds: input.scopeIds,
        causedByEventIds: [],
        origin: {
          kind: "rules-operation",
          id: "rules.actions.traverse-route",
        },
        payload: result,
        access: "public",
      }],
    };
  },
};
