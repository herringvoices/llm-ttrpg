import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ToolCatalogNotFoundError,
  ToolCatalogValidationError,
  ToolUnavailableError,
  createGameRuntime,
  createInMemoryPersistence,
  createResolutionRequestFromBinding,
  executeEngineQueryTool,
  executeRulesOperation,
  fictionalDurationMs,
  initializeCampaignWorld,
  loadGameDefinition,
  type ExecutableIntent,
  type LoadedGameDefinition,
  type SourcedToolCatalogContribution,
  type ToolAvailabilityPolicy,
  type ToolCatalogContribution,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";

const ordinaryToolId = "rules.actions.resolve-effort";
const resolutionToolId = "rules.resolution.resolve-contract-fixture";
const queryToolId = "fixture.state.inspect-entity-name";

const fixtureQueryContribution: SourcedToolCatalogContribution = {
  sourceComponent: { id: "engine-query-fixture", version: "0.1.0" },
  contribution: {
    domains: [
      {
        id: "fixture",
        description: "Test-only engine query capabilities.",
      },
    ],
    subsystems: [
      {
        id: "state",
        domainId: "fixture",
        description: "Read-only test state inspection.",
      },
    ],
    queries: [
      {
        id: queryToolId,
        description: "Return one existing entity's display name.",
        domainId: "fixture",
        subsystemId: "state",
        inputSchema: z.object({ entityId: z.string().min(1) }).strict(),
        outputSchema: z.object({ name: z.string().min(1) }).strict(),
        query(context, input) {
          const entity = context.world.entities.find(
            (candidate) => candidate.id === input.entityId,
          );
          if (!entity) throw new Error(`Entity not found: ${input.entityId}`);
          return { name: entity.name };
        },
      },
    ],
  },
};

function loadCatalogGame(
  extra: readonly SourcedToolCatalogContribution[] = [],
): LoadedGameDefinition {
  return loadGameDefinition(referenceGameDefinition, {
    engineToolCatalogContributions: [fixtureQueryContribution, ...extra],
  });
}

function executableIntent(): ExecutableIntent {
  return {
    actorId: "campaign.entity.amelia",
    goal: "exercise a catalog-bound resolution",
    targetIds: ["campaign.location.brownbag-groceries"],
    pressureLevel: 6,
    requestedHorizonMs: fictionalDurationMs(60_000),
    authorizedHorizonMs: fictionalDurationMs(60_000),
    wasNarrowed: false,
  };
}

describe("hierarchical tool catalog", () => {
  it("progressively discloses sorted hierarchy and schemas only on inspection", () => {
    const catalog = loadCatalogGame().toolCatalog;

    const domains = catalog.listDomains();
    expect(domains).toEqual([
      {
        id: "fixture",
        description: "Test-only engine query capabilities.",
      },
      {
        id: "rules",
        description:
          "Disposable fixture mechanics used to verify rules-tool discovery.",
      },
    ]);
    expect(JSON.stringify(domains)).not.toContain(ordinaryToolId);
    expect(JSON.stringify(domains)).not.toContain(resolutionToolId);
    expect(JSON.stringify(domains)).not.toContain(queryToolId);
    expect(JSON.stringify(domains)).not.toContain("inputSchema");

    const subsystems = catalog.listSubsystems("rules");
    expect(subsystems.map((item) => item.id)).toEqual([
      "actions",
      "resolution",
    ]);
    expect(JSON.stringify(subsystems)).not.toContain(resolutionToolId);
    expect(JSON.stringify(subsystems)).not.toContain("inputSchema");

    const tools = catalog.listTools("rules", "actions");
    expect(tools).toEqual([
      expect.objectContaining({
        id: ordinaryToolId,
        domainId: "rules",
        subsystemId: "actions",
        sourceComponent: referenceGameDefinition.ruleset.identity,
      }),
    ]);
    expect(tools[0]).not.toHaveProperty("inputSchema");
    expect(tools[0]).not.toHaveProperty("outputSchema");
    expect(JSON.stringify(tools)).not.toContain(resolutionToolId);

    const ordinaryContract = catalog.inspectTool(ordinaryToolId);
    expect(ordinaryContract).toHaveProperty(
      "inputSchema.properties.actorId.type",
      "string",
    );
    expect(ordinaryContract).toHaveProperty(
      "outputSchema.properties.success.type",
      "boolean",
    );

    const resolutionContract = catalog.inspectTool(resolutionToolId);
    expect(resolutionContract).toHaveProperty("inputSchema.properties.intent");
    expect(resolutionContract).toHaveProperty("inputSchema.properties.input");
    expect(resolutionContract).toHaveProperty("outputSchema.properties.path");
    expect(resolutionContract).toHaveProperty("outputSchema.properties.result");
    expect(resolutionContract).toHaveProperty(
      "outputSchema.properties.randomness",
    );
  });

  it("fails clearly for unknown hierarchy and tool IDs", () => {
    const catalog = loadCatalogGame().toolCatalog;
    expect(() => catalog.listSubsystems("missing"))
      .toThrow(ToolCatalogNotFoundError);
    expect(() => catalog.listTools("rules", "missing"))
      .toThrow(/unknown tool subsystem/i);
    expect(() => catalog.inspectTool("rules.actions.missing"))
      .toThrow(/unknown tool/i);
    expect(() => catalog.resolveBinding("arbitrary.guessed.tool"))
      .toThrow(ToolCatalogNotFoundError);
  });

  it("applies one availability policy to listings, inspection, and binding", () => {
    const catalog = loadCatalogGame().toolCatalog;
    const denyResolution: ToolAvailabilityPolicy =
      (tool) => tool.id !== resolutionToolId;

    expect(catalog.listSubsystems("rules", denyResolution).map(
      (item) => item.id,
    )).toEqual(["actions"]);
    expect(catalog.listTools("rules", "resolution", denyResolution)).toEqual(
      [],
    );
    expect(() => catalog.inspectTool(resolutionToolId, denyResolution))
      .toThrow(ToolUnavailableError);
    expect(() => catalog.resolveBinding(resolutionToolId, denyResolution))
      .toThrow(ToolUnavailableError);

    const denyQuery: ToolAvailabilityPolicy = (tool) => tool.id !== queryToolId;
    expect(catalog.listDomains(denyQuery).map((item) => item.id)).toEqual([
      "rules",
    ]);
    expect(() => catalog.resolveBinding(queryToolId, denyQuery))
      .toThrow(ToolUnavailableError);

    // No disclosure history exists: direct binding lookup succeeds solely
    // because the registered tool is currently allowed.
    expect(catalog.resolveBinding(queryToolId).kind).toBe("engine-query");
  });
});

describe("tool registration and authoritative bindings", () => {
  it("coalesces identical hierarchy metadata and rejects conflicts", () => {
    const compatible: SourcedToolCatalogContribution = {
      sourceComponent: { id: "compatible-fixture", version: "0.1.0" },
      contribution: {
        domains: [
          {
            id: "rules",
            description:
              "Disposable fixture mechanics used to verify rules-tool discovery.",
          },
        ],
        subsystems: [
          {
            id: "actions",
            domainId: "rules",
            description: "Tiny deterministic action fixtures.",
          },
        ],
        queries: [],
      },
    };
    expect(loadCatalogGame([compatible]).toolCatalog.listDomains().map(
      (item) => item.id,
    )).toEqual(["fixture", "rules"]);

    const conflictingDomain: SourcedToolCatalogContribution = {
      ...compatible,
      sourceComponent: { id: "conflicting-domain", version: "0.1.0" },
      contribution: {
        ...compatible.contribution,
        domains: [{ id: "rules", description: "Conflicting description." }],
      },
    };
    expect(() => loadCatalogGame([conflictingDomain]))
      .toThrow(/conflicting tool domain descriptor/i);

    const conflictingSubsystem: SourcedToolCatalogContribution = {
      ...compatible,
      sourceComponent: { id: "conflicting-subsystem", version: "0.1.0" },
      contribution: {
        ...compatible.contribution,
        subsystems: [{
          id: "actions",
          domainId: "rules",
          description: "Conflicting subsystem description.",
        }],
      },
    };
    expect(() => loadCatalogGame([conflictingSubsystem]))
      .toThrow(/conflicting tool subsystem descriptor/i);
  });

  it("sorts concise tools deterministically within a subsystem", () => {
    const additionalQuery: SourcedToolCatalogContribution = {
      sourceComponent: { id: "sorting-fixture", version: "0.1.0" },
      contribution: {
        domains: [{
          id: "fixture",
          description: "Test-only engine query capabilities.",
        }],
        subsystems: [{
          id: "state",
          domainId: "fixture",
          description: "Read-only test state inspection.",
        }],
        queries: [{
          id: "fixture.state.count-entities",
          description: "Count current entities for sorting verification.",
          domainId: "fixture",
          subsystemId: "state",
          inputSchema: z.object({}).strict(),
          outputSchema: z
            .object({ count: z.number().int().nonnegative() })
            .strict(),
          query: (context) => ({ count: context.world.entities.length }),
        }],
      },
    };
    expect(loadCatalogGame([additionalQuery]).toolCatalog.listTools(
      "fixture",
      "state",
    ).map((tool) => tool.id)).toEqual([
      "fixture.state.count-entities",
      queryToolId,
    ]);
  });

  it("rejects duplicate tool IDs and malformed catalog locations", () => {
    const duplicate: SourcedToolCatalogContribution = {
      sourceComponent: { id: "duplicate-tool-fixture", version: "0.1.0" },
      contribution: {
        domains: [],
        subsystems: [],
        queries: [{
          id: ordinaryToolId,
          description: "Illicit duplicate of a rules operation.",
          domainId: "rules",
          subsystemId: "actions",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({}).strict(),
          query: () => ({}),
        }],
      },
    };
    expect(() => loadCatalogGame([duplicate])).toThrow(/duplicate tool id/i);

    const unknownLocation: SourcedToolCatalogContribution = {
      sourceComponent: { id: "unknown-location", version: "0.1.0" },
      contribution: {
        domains: [],
        subsystems: [],
        queries: [{
          id: "missing.branch.query",
          description: "Invalid location fixture.",
          domainId: "missing",
          subsystemId: "branch",
          inputSchema: z.object({}).strict(),
          outputSchema: z.object({}).strict(),
          query: () => ({}),
        }],
      },
    };
    expect(() => loadCatalogGame([unknownLocation]))
      .toThrow(/unknown domain/i);
  });

  it("projects both operation kinds without duplicating their registry", () => {
    const game = loadCatalogGame();
    const ordinary = game.toolCatalog.resolveBinding(ordinaryToolId);
    const resolution = game.toolCatalog.resolveBinding(resolutionToolId);

    expect(ordinary).toEqual(expect.objectContaining({
      kind: "ordinary-operation",
      operationId: ordinaryToolId,
    }));
    expect(resolution).toEqual(expect.objectContaining({
      kind: "resolution-operation",
      operationId: resolutionToolId,
    }));
    expect(game.operationRegistry.get(ordinaryToolId).metadata.kind).toBe(
      "ordinary",
    );
    expect(game.operationRegistry.get(resolutionToolId).metadata.kind).toBe(
      "resolution",
    );

    const world = initializeCampaignWorld(game, 0x1234_5678);
    expect(() => executeRulesOperation(
      game.operationRegistry,
      ordinary.kind === "ordinary-operation" ? ordinary.operationId : "",
      { world },
      { malformed: true },
    )).toThrow();
  });

  it("executes a validated read-only engine query without exposing its handler", () => {
    const game = loadCatalogGame();
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const before = structuredClone(world);
    const summary = game.toolCatalog.listTools("fixture", "state")[0]!;
    const contract = game.toolCatalog.inspectTool(queryToolId);
    const binding = game.toolCatalog.resolveBinding(queryToolId);

    expect(summary.id).toBe(queryToolId);
    expect(summary).not.toHaveProperty("query");
    expect(contract).not.toHaveProperty("query");
    expect(contract).not.toHaveProperty("binding");
    expect(contract).not.toHaveProperty("kind");
    expect(JSON.stringify(contract)).not.toContain("function");
    expect(executeEngineQueryTool(binding, world, {
      entityId: "campaign.entity.amelia",
    })).toEqual({ name: "Amelia" });
    expect(() => executeEngineQueryTool(binding, world, {
      entityId: 42,
    })).toThrow();
    expect(world).toEqual(before);
  });

  it("keeps resolution invocation on the bounded #8 request path", async () => {
    const game = loadCatalogGame();
    const binding = game.toolCatalog.resolveBinding(resolutionToolId);
    expect(() => createResolutionRequestFromBinding(binding, {
      input: {},
    })).toThrow();

    const request = createResolutionRequestFromBinding(binding, {
      intent: executableIntent(),
      input: {
        actorId: "campaign.entity.amelia",
        mode: "automatic",
        modifier: 0,
        durationMs: 1_000,
      },
    });
    expect(request).toEqual({
      intent: executableIntent(),
      operation: {
        id: resolutionToolId,
        input: {
          actorId: "campaign.entity.amelia",
          mode: "automatic",
          modifier: 0,
          durationMs: 1_000,
        },
      },
    });

    let id = 0;
    const runtime = createGameRuntime({
      persistence: createInMemoryPersistence(),
      wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
      idGenerator: {
        next(kind) {
          return `${kind}.catalog-${++id}`;
        },
      },
      worldSeedSource: { nextSeed: () => 0x1234_5678 },
      game,
    });
    const session = await runtime.createWorld("Catalog resolution");
    const result = await session.resolve(request);
    expect(result.path).toBe("automatic");
    expect(result.operationId).toBe(resolutionToolId);
    if (binding.kind !== "resolution-operation") {
      throw new Error("Expected a resolution-operation binding");
    }
    expect(binding.outputSchema.parse(result)).toEqual(result);
  });

  it("accepts empty optional contributions", () => {
    const empty: SourcedToolCatalogContribution = {
      sourceComponent: { id: "empty-catalog-fixture", version: "0.1.0" },
      contribution: {
        domains: [],
        subsystems: [],
        queries: [],
      } satisfies ToolCatalogContribution,
    };
    expect(() => loadCatalogGame([empty])).not.toThrow();
  });
});
