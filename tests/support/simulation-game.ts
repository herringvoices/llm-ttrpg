import {
  advanceFictionalInstant,
  fictionalDurationMs,
  type EventTypeDefinition,
  type GameDefinition,
  type JsonValue,
  type RulesOperation,
  type WorldProcessCatchUpInput,
  type WorldProcessDefinition,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import { contractTestGameDefinition } from "./contract-game.js";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1_000;

const externalEventPayloadSchema = z.object({ scopeId: z.string().min(1) }).strict();
const pressureEventPayloadSchema = z.object({
  scopeId: z.string().min(1),
  roll: z.number().min(0).max(1),
  supply: z.number().int(),
  disruptions: z.number().int().nonnegative(),
}).strict();

const routeDisruptedEventType: EventTypeDefinition = {
  type: "test.route-disrupted",
  schemaVersion: 1,
  payloadSchema: externalEventPayloadSchema,
};
const unrelatedDevelopmentEventType: EventTypeDefinition = {
  type: "test.unrelated-development",
  schemaVersion: 1,
  payloadSchema: externalEventPayloadSchema,
};
const localSupplyDisruptedEventType: EventTypeDefinition = {
  type: "test.local-supply-disrupted",
  schemaVersion: 1,
  payloadSchema: externalEventPayloadSchema,
};
const localPressureEventType: EventTypeDefinition = {
  type: "test.local-pressure-changed",
  schemaVersion: 1,
  payloadSchema: pressureEventPayloadSchema,
};

const recordExternalInputSchema = z.object({
  type: z.enum(["test.route-disrupted", "test.unrelated-development"]),
  scopeId: z.string().min(1),
}).strict();

const recordExternalEventOperation: RulesOperation<
  z.infer<typeof recordExternalInputSchema>,
  { recorded: true }
> = {
  metadata: {
    id: "test.events.record-external",
    kind: "ordinary",
    description: "Record a test-only external event during a sleeping interval.",
    category: {
      domain: { id: "test", label: "Test" },
      subsystem: { id: "events", label: "Events" },
      tags: ["fixture"],
    },
  },
  inputSchema: recordExternalInputSchema,
  outputSchema: z.object({ recorded: z.literal(true) }).strict(),
  execute(_context, input) {
    return {
      result: { recorded: true as const },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [],
      proposedEvents: [{
        type: input.type,
        schemaVersion: 1,
        summary: `Recorded ${input.type} for ${input.scopeId}.`,
        relatedEntityIds: [],
        scopeIds: [input.scopeId],
        causedByEventIds: [],
        payload: { scopeId: input.scopeId },
        access: "public" as const,
      }],
    };
  },
};

const localityStateSchema = z.object({
  entityId: z.string().min(1),
  supply: z.number().int(),
  disruptions: z.number().int().nonnegative(),
  pressure: z.number().min(0).max(1),
  processLog: z.array(z.string()),
}).strict();

function stateRecord(input: WorldProcessCatchUpInput) {
  return localityStateSchema.parse(input.relevantState);
}

function selectLocalityState(
  world: Parameters<WorldProcessDefinition["selectRelevantState"]>[0]["world"],
  scopeId: string,
): JsonValue {
  const entityId = scopeId === "scope.test-town"
    ? "simulation.entity.test-town"
    : "simulation.entity.unrelated-town";
  const entity = world.entities.find((candidate) => candidate.id === entityId);
  if (!entity) throw new Error(`Missing simulation fixture entity ${entityId}`);
  return localityStateSchema.parse({
    entityId,
    supply: entity.data.supply ?? 0,
    disruptions: entity.data.disruptions ?? 0,
    pressure: entity.data.pressure ?? 0,
    processLog: entity.data["process-log"] ?? [],
  });
}

const supplyProcess: WorldProcessDefinition = {
  metadata: {
    id: "simulation.supply",
    version: "1.0.0",
    description: "Aggregate elapsed local supply and apply due deliveries.",
    kind: "deterministic",
    scopeKinds: ["locality"],
    dependencies: [],
    eventInterests: [],
    scheduledTriggerTypes: ["test.delivery-due"],
  },
  selectRelevantState({ world, scopeId }) {
    return selectLocalityState(world, scopeId);
  },
  runCatchUp(input) {
    const selected = stateRecord(input);
    const weeks = Math.floor(input.elapsedDurationMs / WEEK_MS);
    const delivered = input.dueScheduledWork.reduce((sum, trigger) => {
      const payload = z.object({ amount: z.number().int() }).strict().parse(trigger.payload);
      return sum + payload.amount;
    }, 0);
    const supply = selected.supply - weeks * 3 + delivered;
    return {
      workUnits: weeks,
      mutations: [
        { kind: "set-entity-data", entityId: selected.entityId, key: "supply", value: supply },
        {
          kind: "set-entity-data",
          entityId: selected.entityId,
          key: "process-log",
          value: [...selected.processLog, "supply"],
        },
      ],
      events: [],
      processedScheduledTriggerIds: input.dueScheduledWork.map((trigger) => trigger.id),
      cancelScheduledTriggerIds: [],
      schedule: input.dueScheduledWork.length > 0
        ? [{
            type: "test.delivery-due",
            schemaVersion: 1,
            dueAt: advanceFictionalInstant(input.to, fictionalDurationMs(WEEK_MS)),
            scopeIds: [input.scopeId],
            payload: { amount: 4 },
          }]
        : [],
      diagnostics: { strategy: "weekly-aggregate", weeks, delivered, supply },
    };
  },
};

const disruptionProcess: WorldProcessDefinition = {
  metadata: {
    id: "simulation.disruption",
    version: "1.0.0",
    description: "Apply external route disruptions relevant to one locality.",
    kind: "deterministic",
    scopeKinds: ["locality"],
    dependencies: ["simulation.supply"],
    eventInterests: [{ types: ["test.route-disrupted"], currentScope: true }],
    scheduledTriggerTypes: [],
  },
  selectRelevantState({ world, scopeId }) {
    return selectLocalityState(world, scopeId);
  },
  runCatchUp(input) {
    const selected = stateRecord(input);
    const disruptions = input.relevantEvents.length;
    const supply = selected.supply - disruptions * 20;
    return {
      workUnits: disruptions,
      mutations: [
        { kind: "set-entity-data", entityId: selected.entityId, key: "supply", value: supply },
        {
          kind: "set-entity-data",
          entityId: selected.entityId,
          key: "disruptions",
          value: selected.disruptions + disruptions,
        },
        {
          kind: "set-entity-data",
          entityId: selected.entityId,
          key: "process-log",
          value: [...selected.processLog, "disruption"],
        },
      ],
      events: disruptions > 0
        ? [{
            type: "test.local-supply-disrupted",
            schemaVersion: 1,
            summary: "A relevant external disruption reduced local supply.",
            relatedEntityIds: [selected.entityId],
            scopeIds: [input.scopeId],
            causedByEventIds: input.relevantEvents.map((event) => event.id),
            payload: { scopeId: input.scopeId },
            access: "public" as const,
          }]
        : [],
      processedScheduledTriggerIds: [],
      cancelScheduledTriggerIds: [],
      schedule: [],
      diagnostics: {
        selectedSupply: selected.supply,
        disruptions,
        supply,
      },
    };
  },
};

const pressureProcess: WorldProcessDefinition = {
  metadata: {
    id: "simulation.local-pressure",
    version: "1.0.0",
    description: "Resolve one aggregate stochastic local-pressure outcome.",
    kind: "stochastic",
    scopeKinds: ["locality"],
    dependencies: ["simulation.disruption"],
    eventInterests: [],
    scheduledTriggerTypes: [],
  },
  selectRelevantState({ world, scopeId }) {
    return selectLocalityState(world, scopeId);
  },
  runCatchUp(input) {
    const selected = stateRecord(input);
    const roll = input.rng!.next();
    return {
      workUnits: 1,
      mutations: [
        { kind: "set-entity-data", entityId: selected.entityId, key: "pressure", value: roll },
        {
          kind: "set-entity-data",
          entityId: selected.entityId,
          key: "process-log",
          value: [...selected.processLog, "local-pressure"],
        },
      ],
      events: [{
        type: "test.local-pressure-changed",
        schemaVersion: 1,
        summary: "Aggregate local pressure changed while the locality slept.",
        relatedEntityIds: [selected.entityId],
        scopeIds: [input.scopeId],
        causedByEventIds: [],
        payload: {
          scopeId: input.scopeId,
          roll,
          supply: selected.supply,
          disruptions: selected.disruptions,
        },
        access: "gm-only" as const,
      }],
      processedScheduledTriggerIds: [],
      cancelScheduledTriggerIds: [],
      schedule: [],
      diagnostics: {
        selectedSupply: selected.supply,
        selectedDisruptions: selected.disruptions,
        roll,
      },
    };
  },
};

export function simulationTestGameDefinition(
  options: { readonly failProcess?: boolean } = {},
): GameDefinition {
  const processes = options.failProcess
    ? [
        supplyProcess,
        disruptionProcess,
        {
          ...pressureProcess,
          runCatchUp(input: WorldProcessCatchUpInput) {
            input.rng!.next();
            throw new Error("forced mid-catch-up failure after tentative RNG");
          },
        },
      ]
    : [supplyProcess, disruptionProcess, pressureProcess];
  return {
    ...contractTestGameDefinition,
    ruleset: {
      ...contractTestGameDefinition.ruleset,
      operations: [
        ...contractTestGameDefinition.ruleset.operations,
        recordExternalEventOperation,
      ],
      toolCatalog: {
        domains: [
          ...contractTestGameDefinition.ruleset.toolCatalog!.domains,
        ],
        subsystems: [
          ...contractTestGameDefinition.ruleset.toolCatalog!.subsystems,
          {
            id: "events",
            domainId: "test",
            description: "Test-only external event recording.",
          },
        ],
        queries: [],
      },
    },
    campaign: {
      ...contractTestGameDefinition.campaign,
      eventTypes: [
        ...contractTestGameDefinition.campaign.eventTypes,
        routeDisruptedEventType,
        unrelatedDevelopmentEventType,
        localSupplyDisruptedEventType,
        localPressureEventType,
      ],
      content: {
        ...contractTestGameDefinition.campaign.content,
        entities: [
          ...contractTestGameDefinition.campaign.content.entities,
          {
            id: "simulation.entity.test-town",
            kind: "simulation-fixture",
            name: "Test Town",
            summary: "A test-only locality simulation fixture.",
            data: {
              supply: 100,
              disruptions: 0,
              pressure: 0,
              "process-log": [],
            },
          },
          {
            id: "simulation.entity.unrelated-town",
            kind: "simulation-fixture",
            name: "Unrelated Town",
            summary: "An unrelated test-only locality simulation fixture.",
            data: {
              supply: 100,
              disruptions: 0,
              pressure: 0,
              "process-log": [],
            },
          },
        ],
      },
      worldSimulation: {
        scopes: [
          { id: "scope.world", kind: "world", dependencyScopeIds: [] },
          {
            id: "scope.region",
            kind: "region",
            parentScopeId: "scope.world",
            dependencyScopeIds: [],
          },
          {
            id: "scope.test-town",
            kind: "locality",
            parentScopeId: "scope.region",
            dependencyScopeIds: [],
          },
          {
            id: "scope.test-site",
            kind: "site",
            parentScopeId: "scope.test-town",
            dependencyScopeIds: [],
          },
          {
            id: "scope.unrelated-town",
            kind: "locality",
            parentScopeId: "scope.region",
            dependencyScopeIds: [],
          },
        ],
        processes,
      },
    },
  };
}
