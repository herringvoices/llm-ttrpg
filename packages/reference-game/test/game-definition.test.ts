import {
  GameValidationError,
  SaveCompatibilityError,
  createSaveMetadata,
  createSeededRandom,
  executeRulesOperation,
  initializeCampaignWorld,
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
    const world = initializeCampaignWorld(game);
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
    const world = initializeCampaignWorld(game);
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
    const world = initializeCampaignWorld(game);
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
    const world = initializeCampaignWorld(game);
    const worldBefore = structuredClone(world);
    const mapping = game.adapter.mappings[0];
    expect(mapping).toBeDefined();

    const mappedInput = mapping!.mapInput({
      actorId: "campaign.entity.amelia",
      base: 5,
      difficulty: 7,
      reinforced: true,
    });
    const context = { world, rng: createSeededRandom(17) };
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
      { world, rng: createSeededRandom(17) },
      mappedInput,
    );

    expect(game.operationRegistry.listDomains()).toEqual([
      { id: "rules", label: "Rules" },
    ]);
    expect(game.operationRegistry.listSubsystems("rules")).toEqual([
      { id: "actions", label: "Actions" },
    ]);
    expect(game.operationRegistry.listOperations("rules", "actions")).toHaveLength(
      1,
    );
    expect(first).toEqual(second);
    expect(first.result).toEqual({ total: 7, success: true });
    expect(first.proposedMutations).toEqual([]);
    expect(first.proposedEvents).toHaveLength(1);
    expect(world).toEqual(worldBefore);
  });

  it("initializes mutable world state without mutating campaign definitions", () => {
    const campaignBefore = structuredClone(game.campaign.content);
    const world = initializeCampaignWorld(game);
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
