import {
  GameValidationError,
  SaveCompatibilityError,
  assessResolutionOperation,
  createSaveMetadata,
  fictionalDurationMs,
  initializeCampaignWorld,
  initializeCampaignHistory,
  loadGameDefinition,
  retrieveDocument,
  retrieveKnowledge,
  validateSaveMetadataForGame,
  type GameDefinition,
} from "@llm-ttrpg/engine";
import {
  referenceGameDefinition,
  resolveActionInputSchema,
} from "@llm-ttrpg/reference-game";
import { describe, expect, it } from "vitest";

describe("game package contracts", () => {
  const game = loadGameDefinition(referenceGameDefinition);

  it("loads one explicit, versioned game composition", () => {
    expect(game.composition).toEqual({
      ruleset: { id: "reference-rules", version: "0.2.0" },
      setting: { id: "awakening-earth", version: "0.1.0" },
      adapter: {
        id: "awakening-earth-reference-adapter",
        version: "0.1.0",
      },
      campaign: { id: "nashville-contract-fixture", version: "0.2.0" },
      presentation: { id: "grounded-dramatic", version: "0.1.0" },
    });
  });

  it("keeps hidden canonical truth out of an ordinary actor perspective", () => {
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const knowledge = retrieveKnowledge(
      game,
      world,
      { kind: "actor", id: "campaign.entity.amelia" },
      { subjectId: "setting.entity.awakening-earth" },
    );

    expect(knowledge.facts.map((fact) => fact.id)).toContain(
      "setting.fact.gates-public",
    );
    expect(knowledge.facts.map((fact) => fact.id)).not.toContain(
      "setting.fact.gate-origin-hidden",
    );

    const canonicalKnowledge = retrieveKnowledge(
      game,
      world,
      { kind: "canonical" },
      { subjectId: "setting.entity.awakening-earth" },
    );
    expect(canonicalKnowledge.facts.map((fact) => fact.id)).toContain(
      "setting.fact.gate-origin-hidden",
    );
  });

  it("returns an actor's belief without changing or leaking canonical truth", () => {
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const canonicalBefore = structuredClone(game.setting.content.facts);

    const knowledge = retrieveKnowledge(
      game,
      world,
      { kind: "actor", id: "campaign.entity.amelia" },
      { subjectId: "setting.entity.awakening-earth" },
    );

    expect(knowledge.beliefs).toEqual([
      expect.objectContaining({
        id: "campaign.belief.amelia-gate-origin",
        proposition: "Gates are a naturally occurring atmospheric phenomenon.",
        confidence: 0.8,
      }),
    ]);
    expect(knowledge.beliefs[0]).not.toHaveProperty("truthStatus");
    expect(game.setting.content.facts).toEqual(canonicalBefore);
    expect(
      world.beliefs.find(
        (belief) => belief.id === "campaign.belief.amelia-gate-origin",
      )?.truthStatus,
    ).toBe("false");
  });

  it("retrieves long documents progressively", () => {
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const perspective = {
      kind: "actor" as const,
      id: "campaign.entity.amelia",
    };
    const documentId = "setting.document.gate-field-guide";

    const metadata = retrieveDocument(
      game,
      world,
      perspective,
      documentId,
      { level: "metadata" },
    );
    expect(metadata.level).toBe("metadata");
    expect(metadata).not.toHaveProperty("summary");

    const summary = retrieveDocument(
      game,
      world,
      perspective,
      documentId,
      { level: "summary" },
    );
    expect(summary.level).toBe("summary");
    if (summary.level === "summary") {
      expect(summary.sections).toHaveLength(2);
      expect(summary.sections[0]).not.toHaveProperty("content");
    }

    const section = retrieveDocument(
      game,
      world,
      perspective,
      documentId,
      { level: "section", sectionId: "recognition" },
    );
    expect(section.level).toBe("section");
    if (section.level === "section") {
      expect(section.section.content).toContain("distort nearby light");
    }

    const full = retrieveDocument(game, world, perspective, documentId, {
      level: "full",
    });
    expect(full.level).toBe("full");
    if (full.level === "full") {
      expect(full.document.sections).toHaveLength(2);
    }
  });

  it("enforces pair-specific adapter compatibility", () => {
    const incompatible: GameDefinition = {
      ...referenceGameDefinition,
      adapter: {
        ...referenceGameDefinition.adapter,
        ruleset: { id: "reference-rules", version: "9.9.9" },
      },
    };

    expect(() => loadGameDefinition(incompatible)).toThrow(
      /not compatible with ruleset/,
    );
  });

  it("discovers and executes a deterministic rules operation through the engine", () => {
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const worldBefore = structuredClone(world);
    const mapping = game.adapter.mappings[0];
    expect(mapping).toBeDefined();

    const mappedInput = resolveActionInputSchema.parse(mapping!.mapInput({
      action: {
        declaredActionId: "action.adapter-integration",
        actorId: "campaign.entity.amelia",
        approach: "push against a reinforced obstacle",
        feasibility: { status: "feasible" },
        performance: {
          attributeIds: ["strength"],
          applicableSkillIds: [],
          attributeModifiers: [],
          performanceModifiers: [],
          helpers: [],
          maxUsefulHelpers: 0,
          combinedAttributeContributions: [],
        },
        resistance: {
          kind: "fixed",
          value: 1,
          provenance: {
            kind: "authored",
            description: "Contract integration obstacle",
          },
        },
        effect: { mode: "fixed", potentialEffect: 1 },
        timeToMaterialEffectMs: 1_000,
        scopeIds: ["scope.reference-scene"],
      },
      reinforced: true,
    }));
    const intent = {
      actorId: "campaign.entity.amelia",
      goal: "push through the obstacle",
      targetIds: [],
      pressureLevel: 6 as const,
      requestedHorizonMs: fictionalDurationMs(10_000),
      authorizedHorizonMs: fictionalDurationMs(10_000),
      wasNarrowed: false,
    };
    const first = assessResolutionOperation(
      game.operationRegistry,
      mapping!.operationId,
      world,
      intent,
      mappedInput,
    );
    const second = assessResolutionOperation(
      game.operationRegistry,
      mapping!.operationId,
      world,
      intent,
      mappedInput,
    );

    expect(game.operationRegistry.listDomains()).toEqual([
      { id: "rules", label: "Rules" },
    ]);
    expect(game.operationRegistry.listSubsystems("rules")).toEqual([
      { id: "actions", label: "Actions" },
      { id: "recovery", label: "Recovery" },
      { id: "skills", label: "Skills" },
      { id: "tasks", label: "Tasks" },
      { id: "timing", label: "Timing" },
    ]);
    expect(game.operationRegistry.listOperations("rules", "actions"))
      .toEqual([
        expect.objectContaining({
          id: "rules.actions.concede",
          kind: "ordinary",
        }),
        expect.objectContaining({
          id: "rules.actions.resolve-action",
          kind: "resolution",
        }),
      ]);
    expect(first.path).toBe("automatic");
    expect(first).toEqual(second);
    if (first.path !== "automatic") throw new Error("Expected automatic path");
    expect(first.outcome.result).toEqual(expect.objectContaining({
      success: true,
      realizedEffect: 1,
    }));
    expect(first.outcome.proposedEvents).toHaveLength(1);
    expect(world).toEqual(worldBefore);
  });

  it("publishes only real reference mechanics through the active tool catalog", () => {
    expect(game.toolCatalog.listTools("rules", "actions").map(
      (tool) => tool.id,
    )).toEqual([
      "rules.actions.concede",
      "rules.actions.resolve-action",
    ]);
    expect(game.toolCatalog.listTools("rules", "skills").map(
      (tool) => tool.id,
    )).toEqual(["rules.skills.create-emergent-skill"]);
    const contract = game.toolCatalog.inspectTool(
      "rules.actions.resolve-action",
    );
    expect(contract).toHaveProperty(
      "inputSchema.properties.input.properties.performance",
    );
    expect(contract).toHaveProperty(
      "outputSchema.properties.result.properties.realizedEffect",
    );
    expect(JSON.stringify(game.toolCatalog.listDomains())).not.toMatch(
      /fixture|resolve-effort|resolve-contract/i,
    );
  });

  it("initializes mutable world state without mutating campaign definitions", () => {
    const campaignBefore = structuredClone(game.campaign.content);
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const amelia = world.entities.find(
      (entity) => entity.id === "campaign.entity.amelia",
    );
    expect(amelia).toBeDefined();

    amelia!.data.status = "moved";
    world.facts[0]!.value = "somewhere-else";

    expect(game.campaign.content).toEqual(campaignBefore);
    expect(world.entities).not.toBe(game.campaign.content.entities);
    expect(Object.isFrozen(game.campaign.content)).toBe(true);
    expect(Object.isFrozen(game.campaign.content.entities)).toBe(true);
  });

  it("registers package event schemas and seeds ordered history separately", () => {
    const history = initializeCampaignHistory(game);
    expect(history).toEqual([
      expect.objectContaining({
        id: "campaign.event.store-notice-posted",
        type: "campaign.notice-posted",
        schemaVersion: 1,
        sourceComponent: game.campaign.identity,
        sequence: 1,
      }),
    ]);
    expect(initializeCampaignWorld(game, 0x1234_5678)).not.toHaveProperty("events");
    expect(() => game.eventTypeRegistry.validatePayload(
      "campaign.notice-posted",
      1,
      { documentId: 42 },
    )).toThrow();
  });

  it("rejects duplicate package event registrations", () => {
    const duplicate: GameDefinition = {
      ...referenceGameDefinition,
      setting: {
        ...referenceGameDefinition.setting,
        eventTypes: [...referenceGameDefinition.ruleset.eventTypes],
      },
    };
    expect(() => loadGameDefinition(duplicate)).toThrow(/Duplicate event type/);
  });

  it("records and validates exact save composition versions", () => {
    const metadata = createSaveMetadata(
      game,
      "save.contract-fixture",
      "2026-10-01T12:00:00.000Z",
    );
    expect(validateSaveMetadataForGame(metadata, game)).toEqual(metadata);

    const incompatibleSave = {
      ...metadata,
      game: {
        ...metadata.game,
        setting: { ...metadata.game.setting, version: "0.2.0" },
      },
    };
    expect(() => validateSaveMetadataForGame(incompatibleSave, game)).toThrow(
      SaveCompatibilityError,
    );
  });

  it("fails loudly for malformed references and duplicate IDs", () => {
    const brokenReference: GameDefinition = {
      ...referenceGameDefinition,
      campaign: {
        ...referenceGameDefinition.campaign,
        content: {
          ...referenceGameDefinition.campaign.content,
          facts: [
            ...referenceGameDefinition.campaign.content.facts,
            {
              id: "campaign.fact.broken",
              subjectId: "campaign.entity.missing",
              predicate: "fixture.broken-reference",
              value: true,
              visibility: "public",
              tags: ["fixture"],
            },
          ],
        },
      },
    };
    expect(() => loadGameDefinition(brokenReference)).toThrow(
      /references missing subject/,
    );

    const duplicateId: GameDefinition = {
      ...referenceGameDefinition,
      campaign: {
        ...referenceGameDefinition.campaign,
        content: {
          ...referenceGameDefinition.campaign.content,
          entities: [
            ...referenceGameDefinition.campaign.content.entities,
            referenceGameDefinition.campaign.content.entities[0]!,
          ],
        },
      },
    };
    expect(() => loadGameDefinition(duplicateId)).toThrow(
      GameValidationError,
    );
  });
});
