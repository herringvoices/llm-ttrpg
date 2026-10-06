import { z } from "zod";
import {
  fictionalDurationMs,
  fictionalInstant,
  sceneSourceElementSchema,
  type EventTypeDefinition,
  type GameDefinition,
  type RulesOperation,
  type WorldProcessDefinition,
} from "@llm-ttrpg/engine";
import { defineScenario } from "./contracts.js";

const sparkPayloadSchema = z.object({
  actorId: z.string().min(1),
  targetId: z.string().min(1),
}).strict();

const sparkEventType: EventTypeDefinition<z.infer<typeof sparkPayloadSchema>> = {
  type: "fantasy.spark-cast",
  schemaVersion: 1,
  payloadSchema: sparkPayloadSchema,
};

const restlessnessPayloadSchema = z.object({
  scopeId: z.string().min(1),
  restlessness: z.number().int().nonnegative(),
}).strict();

const restlessnessEventType: EventTypeDefinition<
  z.infer<typeof restlessnessPayloadSchema>
> = {
  type: "fantasy.goblin-restlessness-changed",
  schemaVersion: 1,
  payloadSchema: restlessnessPayloadSchema,
};

const castSparkInputSchema = z.object({
  actorId: z.string().min(1),
  targetId: z.string().min(1),
  durationMs: z.number().int().positive(),
}).strict();

const castSparkResultSchema = z.object({
  startled: z.literal(true),
}).strict();

const castSparkOperation: RulesOperation<
  z.infer<typeof castSparkInputSchema>,
  z.infer<typeof castSparkResultSchema>
> = {
  metadata: {
    id: "fantasy.actions.cast-spark",
    kind: "ordinary",
    description: "Cast a tiny spark that startles one visible creature.",
    category: {
      domain: { id: "fantasy", label: "Fantasy" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["fixture", "magic"],
    },
  },
  inputSchema: castSparkInputSchema,
  outputSchema: castSparkResultSchema,
  execute(context, input) {
    const ids = new Set(context.world.entities.map((entity) => entity.id));
    if (!ids.has(input.actorId) || !ids.has(input.targetId)) {
      throw new Error("Spark participants must exist in the fantasy fixture");
    }
    return {
      result: { startled: true as const },
      advanceTimeByMs: fictionalDurationMs(input.durationMs),
      proposedMutations: [{
        kind: "set-entity-data",
        entityId: input.targetId,
        key: "startled",
        value: true,
      }],
      proposedEvents: [{
        type: "fantasy.spark-cast",
        schemaVersion: 1,
        summary: `${input.actorId} startled ${input.targetId} with a spark.`,
        relatedEntityIds: [input.actorId, input.targetId],
        scopeIds: ["fantasy.scope.town"],
        causedByEventIds: [],
        payload: { actorId: input.actorId, targetId: input.targetId },
        access: "public",
      }],
    };
  },
};

const goblinRestlessnessProcess: WorldProcessDefinition = {
  metadata: {
    id: "fantasy.simulation.goblin-restlessness",
    version: "1.0.0",
    description: "Aggregate how restless the fixture goblin became while town slept.",
    kind: "deterministic",
    scopeKinds: ["town"],
    dependencies: [],
    eventInterests: [],
    scheduledTriggerTypes: [],
  },
  selectRelevantState({ world }) {
    const goblin = world.entities.find((entity) =>
      entity.id === "fantasy.entity.goblin"
    );
    return { restlessness: Number(goblin?.data.restlessness ?? 0) };
  },
  runCatchUp(input) {
    const prior = z.object({ restlessness: z.number().int().nonnegative() })
      .parse(input.relevantState).restlessness;
    const elapsedDays = Math.floor(input.elapsedDurationMs / 86_400_000);
    const restlessness = prior + elapsedDays;
    return {
      workUnits: elapsedDays,
      mutations: [{
        kind: "set-entity-data",
        entityId: "fantasy.entity.goblin",
        key: "restlessness",
        value: restlessness,
      }],
      events: elapsedDays > 0
        ? [{
            type: "fantasy.goblin-restlessness-changed",
            schemaVersion: 1,
            summary: "The goblin grew restless while the town slept.",
            relatedEntityIds: ["fantasy.entity.goblin"],
            scopeIds: [input.scopeId],
            causedByEventIds: [],
            payload: { scopeId: input.scopeId, restlessness },
            access: "gm-only" as const,
          }]
        : [],
      processedScheduledTriggerIds: [],
      cancelScheduledTriggerIds: [],
      schedule: [],
      diagnostics: { elapsedDays, prior, restlessness },
    };
  },
};

export const fantasyHarnessGameDefinition: GameDefinition = {
  ruleset: {
    identity: { id: "fantasy-fixture-rules", version: "1.0.0" },
    description: "Tiny fantasy rules used only to verify harness neutrality.",
    operations: [castSparkOperation],
    eventTypes: [sparkEventType],
    toolCatalog: {
      domains: [{ id: "fantasy", description: "Tiny fantasy fixture mechanics." }],
      subsystems: [{
        id: "actions",
        domainId: "fantasy",
        description: "Fixture magical actions.",
      }],
      queries: [],
    },
  },
  setting: {
    identity: { id: "fantasy-fixture-setting", version: "1.0.0" },
    description: "One test-only town containing a wizard and goblin.",
    eventTypes: [],
    content: {
      entities: [{
        id: "fantasy.location.town",
        kind: "town",
        name: "Little Testwick",
        summary: "A tiny town used only by architecture tests.",
        data: {
          context: {
            category: "feature",
            prominence: "prominent",
            observable: true,
            activeParticipant: false,
            orchestratorVisible: true,
            knownBy: [],
            identities: [],
          },
        },
      }, {
        id: "fantasy.entity.wizard",
        kind: "actor",
        name: "Mira",
        summary: "A novice wizard carrying a willow wand.",
        data: {
          currentLocation: "fantasy.location.town",
          context: {
            locationId: "fantasy.location.town",
            category: "participant",
            prominence: "prominent",
            observable: true,
            activeParticipant: true,
            orchestratorVisible: true,
            knownBy: [{ kind: "actor", id: "fantasy.entity.wizard" }],
            identities: [],
          },
        },
      }, {
        id: "fantasy.entity.goblin",
        kind: "creature",
        name: "Pip",
        summary: "A wary goblin hiding beside the market fountain.",
        data: {
          currentLocation: "fantasy.location.town",
          restlessness: 0,
          startled: false,
          context: {
            locationId: "fantasy.location.town",
            category: "participant",
            prominence: "prominent",
            observable: true,
            activeParticipant: true,
            orchestratorVisible: true,
            knownBy: [{ kind: "actor", id: "fantasy.entity.wizard" }],
            identities: [],
          },
        },
      }],
      facts: [{
        id: "fantasy.fact.goblin-near-fountain",
        subjectId: "fantasy.entity.goblin",
        predicate: "located-near",
        value: "market-fountain",
        visibility: "public",
        tags: ["location"],
      }],
      events: [],
      documents: [],
      beliefs: [],
    },
    worldSimulation: {
      scopes: [{
        id: "fantasy.scope.town",
        kind: "town",
        dependencyScopeIds: [],
      }],
      processes: [goblinRestlessnessProcess],
    },
  },
  adapter: {
    identity: { id: "fantasy-fixture-adapter", version: "1.0.0" },
    description: "No-op adapter for the tiny fantasy fixture.",
    ruleset: { id: "fantasy-fixture-rules", version: "1.0.0" },
    setting: { id: "fantasy-fixture-setting", version: "1.0.0" },
    mappings: [],
    eventTypes: [],
  },
  campaign: {
    identity: { id: "fantasy-fixture-campaign", version: "1.0.0" },
    description: "Test-only fantasy harness campaign.",
    setting: { id: "fantasy-fixture-setting", version: "1.0.0" },
    startTime: fictionalInstant("2042-01-01T00:00:00.000Z"),
    eventTypes: [restlessnessEventType],
    content: {
      entities: [],
      facts: [],
      events: [],
      documents: [],
      beliefs: [],
    },
  },
  presentation: {
    identity: { id: "fantasy-fixture-presentation", version: "1.0.0" },
    description: "Minimal fixture presentation.",
    narrationProfile: {
      identity: { id: "fixture-clear", version: "1.0.0" },
      perspective: { person: "second", tense: "present", camera: "player-limited" },
      playerAgency: {
        inventVoluntaryActions: false,
        inventDialogue: false,
        inventThoughtsFeelingsOrDecisions: false,
        describeGroundedInvoluntaryConsequences: true,
      },
      knowledge: {
        playerObservableOnly: true,
        revealPrivateCognition: false,
        revealHiddenPlans: false,
      },
      voice: {
        tone: ["clear"],
        proseTendencies: ["state visible outcomes directly"],
        humor: "None required.",
        diction: "Plain test language.",
        avoid: ["unsupported details"],
      },
      description: {
        sensoryDetail: "Minimal.",
        expositionDensity: "Low.",
        environment: "Only when supplied.",
        spatialClarity: "Explicit.",
      },
      dialogue: {
        preserveNpcVoice: true,
        attribution: "Direct.",
        preserveQuotedPlayerSpeechVerbatim: true,
      },
      authority: {
        reminder: "Narration cannot change canonical state.",
        transientColorPolicy: "Use only harmless color.",
        actionableDetailPolicy: "Do not invent interactive facts.",
      },
      exemplars: [{
        id: "fixture.example.clear",
        sceneKinds: ["opening", "conversation", "exploration", "action", "immediate-danger", "compressed-duration"],
        text: "The established result is visible. The next decision remains yours.",
      }],
    },
    terminology: {},
    revealMechanics: "detailed",
  },
};

export const fantasyHarnessScenario = defineScenario({
  id: "fantasy.fixture-town",
  description: "Tiny package-neutral wizard, goblin, operation, and simulation fixture.",
  game: fantasyHarnessGameDefinition,
  seed: 0xface_cafe,
  async setup(session) {
    await session.injectMutations([
      ...fantasyHarnessGameDefinition.setting.content.entities.map((entity) => ({
        kind: "add-entity" as const,
        entity,
      })),
      ...fantasyHarnessGameDefinition.setting.content.facts.map((fact) => ({
        kind: "upsert-fact" as const,
        fact,
      })),
    ], "materialize the tiny fantasy fixture into its disposable campaign world");
  },
  sceneSource: {
    derive(world, request) {
      return world.entities.flatMap((entity) => {
        const raw = entity.data.context;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
        const context = raw as Record<string, unknown>;
        if (typeof context.category !== "string" ||
          typeof context.prominence !== "string") return [];
        return [sceneSourceElementSchema.parse({
          canonicalEntityId: entity.id,
          ...(typeof context.locationId === "string"
            ? { locationId: context.locationId }
            : {}),
          displayIdentity: entity.name,
          identities: context.identities ?? [],
          category: context.category,
          prominence: context.prominence,
          summary: entity.summary,
          observable: context.observable ?? true,
          activeParticipant: context.activeParticipant ?? false,
          activeInteraction: Boolean(
            request.workingContext?.activeEntityIds.includes(entity.id),
          ),
          knownBy: context.knownBy ?? [],
          orchestratorVisible: context.orchestratorVisible ?? false,
          sourceKind: "entity",
          sourceIds: [entity.id],
        })];
      });
    },
  },
});
