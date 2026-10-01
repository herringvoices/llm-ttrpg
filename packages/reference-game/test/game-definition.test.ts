import {
  GameValidationError,
  SaveCompatibilityError,
  createSaveMetadata,
  executeRulesOperation,
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
  type effortResultSchema,
} from "@llm-ttrpg/reference-game";
import type { z } from "zod";
import { describe, expect, it } from "vitest";

describe("game package contracts", () => {
  const game = loadGameDefinition(referenceGameDefinition);

  it("loads one explicit, versioned game composition", () => {
    expect(game.composition).toEqual({
      ruleset: { id: "reference-rules", version: "0.1.0" },
      setting: { id: "awakening-earth", version: "0.1.0" },
      adapter: {
        id: "awakening-earth-reference-adapter",
        version: "0.1.0",
      },
      campaign: { id: "nashville-contract-fixture", version: "0.1.0" },
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

    const mappedInput = mapping!.mapInput({
      actorId: "campaign.entity.amelia",
      base: 5,
      difficulty: 7,
      reinforced: true,
    });
    const context = { world };
    const first = executeRulesOperation<
      typeof mappedInput,
      z.infer<typeof effortResultSchema>
    >(game.operationRegistry, mapping!.operationId, context, mappedInput);
    const second = executeRulesOperation<
      typeof mappedInput,
      z.infer<typeof effortResultSchema>
    >(
      game.operationRegistry,
      mapping!.operationId,
      { world },
      mappedInput,
    );

    expect(game.operationRegistry.listDomains()).toEqual([
      { id: "rules", label: "Rules" },
    ]);
    expect(game.operationRegistry.listSubsystems("rules")).toEqual([
      { id: "actions", label: "Actions" },
      { id: "resolution", label: "Resolution" },
    ]);
    expect(game.operationRegistry.listOperations("rules", "actions")).toHaveLength(
      1,
    );
    expect(game.operationRegistry.listOperations("rules", "resolution"))
      .toEqual([
        expect.objectContaining({
          id: "rules.resolution.resolve-contract-fixture",
          kind: "resolution",
        }),
      ]);
    expect(first).toEqual(second);
    expect(first.result).toEqual({ total: 7, success: true });
    expect(first.proposedMutations).toEqual([]);
    expect(first.proposedEvents).toHaveLength(1);
    expect(world).toEqual(worldBefore);
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
