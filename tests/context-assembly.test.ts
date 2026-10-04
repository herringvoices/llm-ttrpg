import { describe, expect, it } from "vitest";
import {
  ToolUnavailableError,
  assembleContext,
  createContextualToolAvailabilityPolicy,
  createContextQueryExecutionOptions,
  createGameRuntime,
  createInMemoryPersistence,
  executeEngineQueryTool,
  fictionalDurationMs,
  fictionalInstant,
  initializeCampaignWorld,
  loadGameDefinition,
  renderContextForModel,
  type ContextAssemblyRequest,
  type ContextItem,
  type GameDefinition,
  type JsonValue,
  type ModelRole,
  type SceneSourceElement,
} from "@llm-ttrpg/engine";
import {
  referenceGameDefinition,
  referenceSceneSource,
} from "@llm-ttrpg/reference-game";

const motelId = "campaign.location.motel-room";
const aliceId = "campaign.entity.alice";
const bobId = "campaign.entity.bob";
const danielId = "campaign.entity.daniel";
const doorId = "campaign.feature.hidden-door";

function contextData(
  overrides: Record<string, JsonValue> = {},
): Record<string, JsonValue> {
  return {
    locationId: motelId,
    category: "object",
    prominence: "ambient",
    observable: true,
    activeParticipant: false,
    orchestratorVisible: true,
    knownBy: [],
    identities: [],
    ...overrides,
  };
}

function fixtureDefinition(): GameDefinition {
  const base = referenceGameDefinition;
  return {
    ...base,
    campaign: {
      ...base.campaign,
      identity: { id: "context-fixture", version: "0.1.0" },
      description: "Context assembly verification fixture.",
      content: {
        ...base.campaign.content,
        entities: [
          ...base.campaign.content.entities,
          {
            id: motelId,
            kind: "location",
            name: "Room 12",
            summary: "A worn but ordinary roadside motel room.",
            data: { context: contextData({ category: "feature", prominence: "prominent" }) },
          },
          {
            id: aliceId,
            kind: "actor",
            name: "Alice",
            summary: "A guest who noticed an unusual seam behind the bookcase.",
            data: {
              currentLocation: motelId,
              context: contextData({
                category: "participant",
                prominence: "prominent",
                activeParticipant: true,
                knownBy: [{ kind: "actor", id: aliceId }],
              }),
            },
          },
          {
            id: bobId,
            kind: "actor",
            name: "Bob",
            summary: "A guest who has not noticed anything concealed.",
            data: {
              currentLocation: motelId,
              context: contextData({
                category: "participant",
                prominence: "prominent",
                activeParticipant: true,
                knownBy: [{ kind: "actor", id: bobId }],
              }),
            },
          },
          {
            id: danielId,
            kind: "actor",
            name: "Daniel Mercer",
            summary: "A courier waiting beside the television.",
            data: {
              currentLocation: motelId,
              context: contextData({
                category: "participant",
                prominence: "prominent",
                activeParticipant: true,
                unrecognizedIdentity: "masked figure",
              }),
            },
          },
          {
            id: doorId,
            kind: "feature",
            name: "Concealed service door",
            summary: "A narrow door hidden behind the bookcase.",
            data: {
              context: contextData({
                category: "feature",
                prominence: "prominent",
                observable: false,
                knownBy: [{ kind: "actor", id: aliceId }],
                discovery: {
                  status: "conditionally-discoverable",
                  guidance: "Deliberate inspection could reveal the seam.",
                  capabilityIds: ["rules.actions.resolve-action"],
                },
              }),
            },
          },
          ...[
            "lamp",
            "nightstand",
            "curtains",
            "chair",
            "bible",
            "wastebasket",
            "television",
            "smoke-detector",
          ].map((name) => ({
            id: `campaign.object.${name}`,
            kind: "object",
            name: name.replaceAll("-", " "),
            summary: `An ordinary motel ${name.replaceAll("-", " ")}.`,
            data: {
              context: contextData({
                coarseState: { obviousCondition: "intact" },
                ...(name === "lamp"
                  ? { detail: { shade: "beige", switch: "off" } }
                  : {}),
              }),
              privateFixtureDetail: `full-${name}-record`,
            },
          })),
          {
            id: "campaign.condition.dim-light",
            kind: "condition",
            name: "dim amber lighting",
            summary: "A single lamp leaves the corners of the room dim.",
            data: {
              context: contextData({
                category: "condition",
                prominence: "prominent",
                coarseState: { lighting: "dim" },
              }),
            },
          },
        ],
        facts: [
          ...base.campaign.content.facts,
          {
            id: "campaign.fact.room-lighting",
            subjectId: motelId,
            predicate: "room.lighting",
            value: "dim",
            visibility: "public",
            tags: ["scene", "lighting"],
          },
          {
            id: "campaign.fact.hidden-door",
            subjectId: doorId,
            predicate: "feature.concealed-exit",
            value: true,
            visibility: "hidden",
            tags: ["scene", "secret"],
          },
        ],
        beliefs: [
          ...base.campaign.content.beliefs,
          {
            id: "campaign.belief.alice-hidden-door",
            holder: { kind: "actor", id: aliceId },
            subjectId: doorId,
            proposition: "There is probably a service door behind the bookcase.",
            truthStatus: "true",
            confidence: 0.9,
            sourceFactId: "campaign.fact.hidden-door",
          },
        ],
        events: [
          ...base.campaign.content.events,
          {
            id: "campaign.event.motel-public",
            type: "campaign.notice-posted",
            schemaVersion: 1,
            occurredAt: fictionalInstant("2026-04-12T13:56:00.000Z"),
            relatedEntityIds: [motelId, aliceId],
            scopeIds: ["scope.motel"],
            causedByEventIds: [],
            origin: { kind: "campaign-initialization", id: "context-fixture" },
            summary: "Alice checked into Room 12.",
            payload: { documentId: "campaign.document.store-notice" },
            access: "public",
          },
          {
            id: "campaign.event.motel-secret",
            type: "campaign.notice-posted",
            schemaVersion: 1,
            occurredAt: fictionalInstant("2026-04-12T13:57:00.000Z"),
            relatedEntityIds: [motelId, doorId],
            scopeIds: ["scope.motel"],
            causedByEventIds: [],
            origin: { kind: "campaign-initialization", id: "context-fixture" },
            summary: "The concealed service door was secured from the corridor.",
            payload: { documentId: "campaign.document.store-notice" },
            access: "gm-only",
          },
          {
            id: "campaign.event.unrelated",
            type: "campaign.notice-posted",
            schemaVersion: 1,
            occurredAt: fictionalInstant("2026-04-12T13:58:00.000Z"),
            relatedEntityIds: ["campaign.location.brownbag-groceries"],
            scopeIds: ["scope.store"],
            causedByEventIds: [],
            origin: { kind: "campaign-initialization", id: "context-fixture" },
            summary: "The grocery store changed its window display.",
            payload: { documentId: "campaign.document.store-notice" },
            access: "public",
          },
        ],
      },
    },
  };
}

function request(
  role: ModelRole,
  actorId: string,
  maxUnits = 50_000,
): ContextAssemblyRequest {
  return {
    role,
    perspective: { kind: "actor", id: actorId },
    focalActorId: actorId,
    locationId: motelId,
    declaration: "Look around the room and address the masked person.",
    workingContext: {
      interactionId: "interaction.motel",
      currentConversationEntityId: danielId,
      activeEntityIds: [danielId],
      recentEntityIds: ["campaign.object.lamp"],
      aliases: [{ alias: "him", entityId: danielId }],
    },
    budget: { maxUnits },
  };
}

function setup() {
  const game = loadGameDefinition(fixtureDefinition());
  const world = initializeCampaignWorld(game, 0x1234_5678);
  return { game, world };
}

describe("context assembly and perspective boundaries", () => {
  it("prefers a mutable current-location fact over an entity's seeded location", () => {
    const { game, world } = setup();
    world.facts.push({
      id: "state.fact.location.campaign.entity.alice",
      subjectId: aliceId,
      predicate: "actor.current-location",
      value: "campaign.location.brownbag-groceries",
      visibility: "public",
      tags: ["location", "movement"],
    });

    const { locationId: _seededLocation, ...derivedRequest } = request(
      "actor",
      aliceId,
    );
    const context = assembleContext({
      game,
      world,
      worldRevision: 1,
      request: derivedRequest,
      sceneSource: referenceSceneSource,
    });

    expect(context.situation.locationRef).toBeDefined();
    expect(
      context.diagnostics.localReferences[context.situation.locationRef!],
    ).toBe("campaign.location.brownbag-groceries");
  });

  it("gives two NPCs shared observations but only the knowledgeable NPC the hidden element", () => {
    const { game, world } = setup();
    const alice = assembleContext({
      game,
      world,
      worldRevision: 0,
      request: request("actor", aliceId),
      sceneSource: referenceSceneSource,
    });
    const bob = assembleContext({
      game,
      world,
      worldRevision: 0,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
    });

    expect(alice.situation.scene.some((item) => item.displayIdentity === "Concealed service door")).toBe(true);
    expect(bob.situation.scene.some((item) => item.displayIdentity.includes("door"))).toBe(false);
    expect(alice.situation.scene.some((item) => item.displayIdentity === "dim amber lighting")).toBe(true);
    expect(bob.situation.scene.some((item) => item.displayIdentity === "dim amber lighting")).toBe(true);
    expect(JSON.stringify(bob)).not.toContain(doorId);
    expect(JSON.stringify(bob)).not.toContain("service door");
  });

  it("gives orchestration latent truth with explicit actor-awareness and discovery metadata", () => {
    const { game, world } = setup();
    const context = assembleContext({
      game,
      world,
      worldRevision: 3,
      request: request("orchestrator", bobId),
      sceneSource: referenceSceneSource,
    });
    const door = context.situation.scene.find(
      (item) => item.displayIdentity === "Concealed service door",
    );
    expect(door).toEqual(expect.objectContaining({
      prominence: "latent",
      access: expect.objectContaining({
        actorAware: false,
        privileged: true,
        discoveryStatus: "conditionally-discoverable",
      }),
    }));
    expect(context.diagnostics.decisions.find(
      (item) => item.canonicalEntityId === doorId,
    )?.provenance).toEqual(expect.objectContaining({
      sourceKind: "entity",
      sourceIds: [doorId],
      worldRevision: 3,
    }));
  });

  it("projects masked identity without leaking canonical identity to an actor", () => {
    const { game, world } = setup();
    const actor = assembleContext({
      game,
      world,
      worldRevision: 0,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
    });
    const visible = renderContextForModel(actor);
    expect(visible).toContain("masked figure");
    expect(visible).not.toContain("Daniel Mercer");
    expect(visible).not.toContain(danielId);
    const masked = actor.situation.scene.find((item) => item.displayIdentity === "masked figure")!;
    expect(actor.diagnostics.localReferences[masked.localRef]).toBe(danielId);

    const knownWorld = structuredClone(world);
    const daniel = knownWorld.entities.find((entity) => entity.id === danielId)!;
    const metadata = daniel.data.context as Record<string, unknown>;
    metadata.knownBy = [{ kind: "actor", id: bobId }];
    const rebuilt = assembleContext({
      game,
      world: knownWorld,
      worldRevision: 1,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
    });
    expect(renderContextForModel(rebuilt)).toContain("Daniel Mercer");
  });

  it("keeps ambient existence cheap and expands only an authorized local reference", async () => {
    const { game, world } = setup();
    const context = assembleContext({
      game,
      world,
      worldRevision: 0,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
    });
    const lamp = context.situation.scene.find((item) => item.displayIdentity === "lamp")!;
    expect(lamp.prominence).toBe("ambient");
    expect(JSON.stringify(context.situation.scene)).not.toContain("full-lamp-record");

    const binding = game.toolCatalog.resolveBinding("knowledge.world.inspect-entity");
    const detail = await executeEngineQueryTool(
      binding,
      world,
      { localRef: lamp.localRef },
      {
        ...createContextQueryExecutionOptions({
          context,
          request: request("actor", bobId),
          world,
          sceneSource: referenceSceneSource,
        }),
      },
    );
    expect(detail).toEqual({
      localRef: lamp.localRef,
      displayIdentity: "lamp",
      detail: { shade: "beige", switch: "off" },
    });
    expect(JSON.stringify(detail)).not.toContain("nightstand");
  });

  it("is deterministic under budget and reduces ambient detail before current anchors", () => {
    const { game, world } = setup();
    const large = assembleContext({
      game,
      world,
      worldRevision: 0,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
    });
    const tightRequest = request("actor", bobId, large.diagnostics.requiredUnits + 1_500);
    const first = assembleContext({ game, world, worldRevision: 0, request: tightRequest, sceneSource: referenceSceneSource });
    const second = assembleContext({ game, world, worldRevision: 0, request: tightRequest, sceneSource: referenceSceneSource });
    expect(first).toEqual(second);
    expect(first.situation.scene.some((item) => item.displayIdentity === "masked figure")).toBe(true);
    expect(first.situation.scene.filter((item) => item.prominence === "ambient").length)
      .toBeLessThan(large.situation.scene.filter((item) => item.prominence === "ambient").length);
    expect(first.diagnostics.decisions.some((item) => item.decision === "compressed" || item.decision === "omitted")).toBe(true);
  });

  it("projects execution constraints without leaking canonical target identity", () => {
    const { game, world } = setup();
    world.actionPressure = { status: "assessed", level: 9 };
    const actorRequest = request("actor", bobId);
    actorRequest.executableIntent = {
      actorId: bobId,
      goal: "question the masked person",
      targetIds: [danielId],
      requestedHorizonMs: fictionalDurationMs(20_000),
      pressureLevel: 9,
      authorizedHorizonMs: fictionalDurationMs(5_000),
      wasNarrowed: true,
    };
    const context = assembleContext({
      game,
      world,
      worldRevision: 1,
      request: actorRequest,
      sceneSource: referenceSceneSource,
    });
    expect(context.situation.actionPressure).toEqual({
      status: "assessed",
      level: 9,
      maximumResolutionHorizonMs: 5_000,
    });
    expect(context.situation.executableIntent).toEqual(expect.objectContaining({
      targetRefs: [expect.stringMatching(/^scene\./)],
      authorizedHorizonMs: 5_000,
    }));
    expect(renderContextForModel(context)).not.toContain(danielId);
  });

  it("keeps plan material protected and invalidates stale retrieved projections", () => {
    const { game, world } = setup();
    const planItem: ContextItem = {
      localId: "retrieved.plan.001",
      kind: "campaign-plan",
      salience: "retrieved" as const,
      content: { possibility: "The courier may leave if the room becomes unsafe." },
      provenance: {
        sourceKind: "plan" as const,
        sourceIds: ["plan.thread.courier"],
        worldRevision: 2,
      },
      access: {
        audience: ["actor", "orchestrator", "planner"],
        perspective: { kind: "actor" as const, id: bobId },
        actorAware: false,
        identityRecognized: false,
        privileged: true,
      },
      derivation: "projected" as const,
      relevance: 80,
    };
    const staleItem: ContextItem = {
      localId: "retrieved.entity.001",
      kind: "entity-detail",
      salience: "retrieved" as const,
      content: { oldCondition: "open" },
      provenance: {
        sourceKind: "entity" as const,
        sourceIds: ["campaign.object.lamp"],
        worldRevision: 1,
      },
      access: {
        audience: ["orchestrator"],
        perspective: { kind: "actor" as const, id: bobId },
        actorAware: true,
        identityRecognized: true,
        privileged: false,
      },
      derivation: "projected" as const,
      relevance: 90,
    };
    const canonicalSecret: ContextItem = {
      localId: "retrieved.fact.001",
      kind: "canonical-fact",
      salience: "retrieved",
      content: { concealed: true },
      provenance: {
        sourceKind: "fact",
        sourceIds: ["campaign.fact.hidden-door"],
        worldRevision: 2,
      },
      access: {
        audience: ["actor", "orchestrator"],
        perspective: { kind: "canonical" },
        actorAware: false,
        identityRecognized: false,
        privileged: true,
      },
      derivation: "raw",
      relevance: 100,
    };
    const actor = assembleContext({
      game,
      world,
      worldRevision: 2,
      request: request("actor", bobId),
      sceneSource: referenceSceneSource,
      retrieved: [planItem, canonicalSecret],
    });
    expect(actor.retrieved).toEqual([]);

    const orchestrator = assembleContext({
      game,
      world,
      worldRevision: 2,
      request: request("orchestrator", bobId),
      sceneSource: referenceSceneSource,
      retrieved: [planItem, staleItem, canonicalSecret],
    });
    expect(orchestrator.retrieved).toEqual([canonicalSecret, planItem]);
    expect(renderContextForModel(orchestrator)).toContain('"sourceKind":"plan"');
    expect(orchestrator.diagnostics.decisions).toContainEqual(
      expect.objectContaining({
        localId: "retrieved.entity.001",
        decision: "omitted",
        reason: expect.stringContaining("stale"),
      }),
    );
  });

  it("rebuilds from current authoritative state and produces no state or RNG side effects", async () => {
    const game = loadGameDefinition(fixtureDefinition());
    const persistence = createInMemoryPersistence();
    let id = 0;
    const runtime = createGameRuntime({
      persistence,
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.context-${++id}` },
      worldSeedSource: { nextSeed: () => 0x1234_5678 },
      game,
      context: { sceneSource: referenceSceneSource },
    });
    const session = await runtime.createWorld("Context freshness");
    const before = session.snapshot();
    const first = session.assembleContext(request("actor", bobId));
    expect(session.snapshot()).toEqual(before);
    await session.advanceTime(fictionalDurationMs(60_000));
    const second = session.assembleContext(request("actor", bobId));
    expect(second.situation.fictionalTime).not.toBe(first.situation.fictionalTime);
    expect(second.diagnostics.worldRevision).toBeGreaterThan(first.diagnostics.worldRevision);
    expect(session.snapshot().randomness).toEqual(before.randomness);
    expect(await session.eventHistory()).toHaveLength(fixtureDefinition().campaign.content.events.length);
  });
});

describe("progressive retrieval and contextual catalog policy", () => {
  it("filters facts/beliefs and never exposes belief truth status", async () => {
    const { game, world } = setup();
    const binding = game.toolCatalog.resolveBinding("knowledge.facts.retrieve");
    const alice = await executeEngineQueryTool(binding, world, { subjectId: doorId }, {
      authorization: { role: "actor", perspective: { kind: "actor", id: aliceId }, focalActorId: aliceId },
    });
    const bob = await executeEngineQueryTool(binding, world, { subjectId: doorId }, {
      authorization: { role: "actor", perspective: { kind: "actor", id: bobId }, focalActorId: bobId },
    });
    expect(alice).toEqual({
      facts: [],
      beliefs: [expect.objectContaining({ proposition: expect.stringContaining("service door") })],
    });
    expect(JSON.stringify(alice)).not.toContain("truthStatus");
    expect(bob).toEqual({ facts: [], beliefs: [] });
  });

  it("retrieves only bounded, role-allowed relevant history", async () => {
    const game = loadGameDefinition(fixtureDefinition());
    const persistence = createInMemoryPersistence();
    let id = 0;
    const session = await createGameRuntime({
      persistence,
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.history-${++id}` },
      worldSeedSource: { nextSeed: () => 123 },
      game,
    }).createWorld("History retrieval");
    const binding = game.toolCatalog.resolveBinding("knowledge.history.retrieve");
    const actor = await executeEngineQueryTool(binding, session.snapshot(), {
      scopeId: "scope.motel",
      direction: "ascending",
      limit: 10,
    }, {
      worldId: session.worldId,
      history: persistence.history,
      authorization: { role: "actor", perspective: { kind: "actor", id: bobId }, focalActorId: bobId },
    });
    const orchestrator = await executeEngineQueryTool(binding, session.snapshot(), {
      scopeId: "scope.motel",
      direction: "ascending",
      limit: 10,
    }, {
      worldId: session.worldId,
      history: persistence.history,
      authorization: { role: "orchestrator", perspective: { kind: "actor", id: bobId }, focalActorId: bobId },
    });
    expect(actor).toHaveLength(1);
    expect(JSON.stringify(actor)).not.toContain("secured from the corridor");
    expect(orchestrator).toHaveLength(2);
    expect(JSON.stringify(orchestrator)).not.toContain("window display");
  });

  it("preserves progressive document retrieval through validated catalog queries", async () => {
    const { game, world } = setup();
    const binding = game.toolCatalog.resolveBinding("knowledge.documents.retrieve");
    const options = {
      authorization: {
        role: "actor" as const,
        perspective: { kind: "actor" as const, id: bobId },
        focalActorId: bobId,
      },
    };
    const documentId = "setting.document.public-awakening-primer";
    const metadata = await executeEngineQueryTool(binding, world, { documentId, request: { level: "metadata" } }, options);
    const summary = await executeEngineQueryTool(binding, world, { documentId, request: { level: "summary" } }, options);
    const section = await executeEngineQueryTool(binding, world, { documentId, request: { level: "section", sectionId: "setting.document-section.gates" } }, options);
    const full = await executeEngineQueryTool(binding, world, { documentId, request: { level: "full" } }, options);
    expect(metadata).not.toHaveProperty("summary");
    expect(summary).toHaveProperty("sections");
    expect(section).toHaveProperty("section.content");
    expect(full).toHaveProperty("document.sections.1.content");
  });

  it("applies contextual policy to listing, inspection, and guessed direct binding", () => {
    const { game } = setup();
    const toolId = "knowledge.history.retrieve";
    const actorPolicy = createContextualToolAvailabilityPolicy({
      authorization: { role: "actor", perspective: { kind: "actor", id: bobId }, focalActorId: bobId },
      rules: [{ toolId, roles: ["orchestrator", "planner", "debug"] }],
    });
    expect(game.toolCatalog.listTools("knowledge", "history", actorPolicy)).toEqual([]);
    expect(() => game.toolCatalog.inspectTool(toolId, actorPolicy)).toThrow(ToolUnavailableError);
    expect(() => game.toolCatalog.resolveBinding(toolId, actorPolicy)).toThrow(ToolUnavailableError);

    const orchestratorPolicy = createContextualToolAvailabilityPolicy({
      authorization: { role: "orchestrator", perspective: { kind: "actor", id: bobId }, focalActorId: bobId },
      rules: [{ toolId, roles: ["orchestrator", "planner", "debug"] }],
    });
    expect(game.toolCatalog.resolveBinding(toolId, orchestratorPolicy).kind).toBe("engine-query");
  });
});
