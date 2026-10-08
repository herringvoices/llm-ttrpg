import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
import {
  GenerationStageError,
  createGameRuntime,
  createInMemoryPersistence,
  executeEngineQueryTool,
  fictionalDurationMs,
  loadGameDefinition,
  type EventTypeDefinition,
  type GameDefinition,
  type ModelInvocationOptions,
  type ModelRuntime,
  type PersistencePorts,
  type RulesOperation,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";
import {
  ATTRIBUTE_IDS,
  awakeningEarthModernBaseline,
  createStartingRegionProposalModel,
  densifyGeneratedEntity,
  ensureOpeningCreature,
  generateStartingRegion,
  normalizedRegionConstraintsSchema,
  promoteObservedPerson,
  referenceGameDefinition,
  rulesActorStateSchema,
  rulesCreatureStateSchema,
  sourceContainsQuotedText,
  startingRegionWorkingStateSchema,
  type StartingRegionSeed,
} from "@llm-ttrpg/reference-game";
import { createMigratedSqlitePersistence } from "../../../tests/support/sqlite.js";
import {
  DeterministicStartingRegionModel,
  generatedStart,
  startingRegionRequestFixture,
  startingRegionStageOutputs,
} from "./starting-region-fixture.js";

function attributes(value = 54, overrides: Record<string, number> = {}) {
  return Object.fromEntries(ATTRIBUTE_IDS.map((id) => [
    id,
    overrides[id] ?? value,
  ]));
}

function runtimeDependencies(
  persistence: PersistencePorts,
  game: ReturnType<typeof loadGameDefinition>,
  prefix: string,
) {
  let id = 0;
  return {
    persistence,
    wallClock: { now: () => "2041-05-01T15:00:00.000Z" },
    idGenerator: { next: (kind: string) => `${kind}.${prefix}-${++id}` },
    worldSeedSource: { nextSeed: () => 0x1234_5678 },
    game,
  };
}

async function generatedGame(
  model = new DeterministicStartingRegionModel({ repairLocalityOnce: true }),
) {
  const result = await generateStartingRegion(startingRegionRequestFixture, model);
  if (result.kind !== "generated") throw new Error("Expected generated region");
  const definition: GameDefinition = {
    ...referenceGameDefinition,
    campaign: result.campaign,
  };
  return { result, model, definition };
}

const socialChangedPayloadSchema = z.object({ actorId: z.string() }).strict();
const socialChangedEventType: EventTypeDefinition<
  z.infer<typeof socialChangedPayloadSchema>
> = {
  type: "test.social-state-changed",
  schemaVersion: 1,
  payloadSchema: socialChangedPayloadSchema,
};

class OptionsRecordingModelRuntime implements ModelRuntime {
  readonly capabilities;
  readonly invocationOptions: ModelInvocationOptions[] = [];

  constructor(private readonly delegate: ScriptedModelRuntime) {
    this.capabilities = delegate.capabilities;
  }

  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    this.invocationOptions.push(options ?? {});
    if (request.output.kind === "text") {
      return this.delegate.generate(request as TextModelRequest, options);
    }
    return this.delegate.generate(request as StructuredModelRequest<T>, options);
  }
}
const changeAliceRelationshipOperation: RulesOperation<
  { actorId: string },
  { changed: true }
> = {
  metadata: {
    id: "rules.actions.change-social-state",
    kind: "ordinary",
    description: "Test a meaningful targeted social-state mutation.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["test"],
    },
  },
  inputSchema: z.object({ actorId: z.string() }).strict(),
  outputSchema: z.object({ changed: z.literal(true) }).strict(),
  execute(_context, input) {
    return {
      result: { changed: true as const },
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: [{
        kind: "upsert-actor-relationship" as const,
        actorId: input.actorId,
        relationship: {
          id: "relationship.alice-player",
          targetEntityId: "generated.actor.player",
          dimensions: { trust: 0.7, concern: 0.9 },
          salience: 0.95,
          tags: ["family", "shared-danger"],
          lastUpdatedAt: generatedStart,
        },
      }],
      proposedEvents: [{
        type: "test.social-state-changed",
        schemaVersion: 1,
        summary: "Alice's trust changed after a meaningful shared danger.",
        relatedEntityIds: [input.actorId, "generated.actor.player"],
        scopeIds: ["scope.generated.locality.riverside"],
        causedByEventIds: [],
        payload: { actorId: input.actorId },
        access: "gm-only" as const,
      }],
    };
  },
};

function withSocialOperation(definition: GameDefinition): GameDefinition {
  return {
    ...definition,
    ruleset: {
      ...definition.ruleset,
      operations: [...definition.ruleset.operations, changeAliceRelationshipOperation],
      eventTypes: [...definition.ruleset.eventTypes, socialChangedEventType],
    },
  };
}

function humanMechanics(empathy = 60) {
  return rulesActorStateSchema.parse({
    attributes: attributes(54, { empathy }),
    skills: [{
      id: "skill.clinic-intake",
      name: "Clinic Intake",
      description: "Practical patient intake and scheduling.",
      specificity: 2,
      sp: 50,
    }],
    stress: { injury: 0, fear: 0, anger: 0, exhaustion: 0, insecurity: 0 },
    statuses: [],
    progression: {
      characterLevel: 0,
      characterXp: 0,
      skillPointsPerCharacterLevel: 5,
      skillLearningRateMultiplier: 1,
      skillUseEvidence: [],
      powers: [],
    },
    isPlayerCharacter: false,
  });
}

function creatureMechanics(agility = 70) {
  return rulesCreatureStateSchema.parse({
    attributes: attributes(60, { agility }),
    skills: [{
      id: "skill.ambush",
      name: "Ambush",
      description: "Predatory concealment and explosive movement.",
      specificity: 2,
      sp: 80,
    }],
    stress: { injury: 0, fear: 0, anger: 0, exhaustion: 0, insecurity: 0 },
    statuses: [],
    isPlayerCharacter: false,
  });
}

describe("generated starting region", () => {
  it("anchors locality generation to contemporary Awakening Earth infrastructure", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([{
      id: "modern-locality",
      match: {
        schemaId: "starting-region.locality.v1",
        predicate: (request) => {
          expect(request.prompt.instructions).toEqual(expect.arrayContaining([
            awakeningEarthModernBaseline,
            "Do not default to medieval or pseudo-medieval fantasy. Unless player-established facts explicitly support a historic or isolated exception, use contemporary roads, vehicles, utilities, communications, businesses, services, and public institutions; a town or rural setting is still modern.",
          ]));
          return true;
        },
      },
      result: { kind: "structured", value: outputs.locality },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("locality", {
      request: startingRegionRequestFixture,
    })).resolves.toEqual(outputs.locality);
  });

  it("keeps institution proposals compact and limited to real service-area entities", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([{
      id: "compact-institutions",
      match: {
        schemaId: "starting-region.institutions.v1",
        predicate: (request) => {
          expect(request.prompt.instructions).toEqual(expect.arrayContaining([
            "Return only one or two locally relevant institutions. Use an empty object for every entity.data field; do not invent nested metadata there.",
            "Keep each goals, capabilities, resources, constraints, and currentPressures list to at most two concise one-sentence entries.",
            "Set serviceAreaEntityId only to the provided region.id or settlement.id; settlement district IDs are descriptive and are not world entities.",
          ]));
          return true;
        },
      },
      result: { kind: "structured", value: outputs.institutions },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("institutions", {
      request: startingRegionRequestFixture,
      region: outputs.region,
      settlement: outputs.settlement,
    })).resolves.toEqual(outputs.institutions);
  });

  it("normalizes a generated mundane prelude into an immediate phenomenon opening", async () => {
    const outputs = startingRegionStageOutputs();
    const candidate = {
      ...outputs["opening-situation"],
      openingMode: "mundane-manifestation",
      supernaturalFocus: "creature",
    };
    const runtime = new ScriptedModelRuntime([{
      id: "contradictory-mundane-opening",
      match: { schemaId: "starting-region.opening-situation.v1" },
      result: { kind: "structured", value: candidate },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("opening-situation", {
      request: startingRegionRequestFixture,
    })).resolves.toEqual({
      ...candidate,
      openingMode: "supernatural-inciting-incident",
      supernaturalFocus: "phenomenon",
      manifestationTargetTurn: 1,
    });
  });

  it("turns opening entity references into concrete narrative guidance", async () => {
    const outputs = startingRegionStageOutputs();
    const creature = outputs.pressures.creatures[0]!;
    const pressure = outputs.pressures.pressures.find((item) =>
      item.category === "supernatural"
    )!;
    const candidate = {
      ...outputs["opening-situation"],
      awakeningEvent: creature.entity.id,
      manifestationOpportunity: pressure.id,
      manifestationTargetTurn: 3,
    };
    const runtime = new ScriptedModelRuntime([{
      id: "id-based-opening-guidance",
      match: { schemaId: "starting-region.opening-situation.v1" },
      result: { kind: "schema-invalid", value: candidate },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    const context = startingRegionWorkingStateSchema.parse({
      request: startingRegionRequestFixture,
      pressures: outputs.pressures.pressures,
      creatures: outputs.pressures.creatures,
    });
    await expect(proposal.propose("opening-situation", context))
      .resolves.toEqual(expect.objectContaining({
      awakeningEvent: expect.stringContaining(creature.entity.name),
      manifestationOpportunity: expect.stringContaining("first committed attempt"),
      manifestationTargetTurn: 1,
      }));
  });

  it("forwards ordinary parsed schema-invalid JSON to the bounded stage repair pipeline", async () => {
    const candidate = { wrong: true };
    const runtime = new ScriptedModelRuntime([{
      id: "invalid-locality",
      match: { schemaId: "starting-region.locality.v1" },
      result: { kind: "schema-invalid", value: candidate },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("locality", {
      request: startingRegionRequestFixture,
    })).resolves.toEqual(candidate);
  });

  it("normalizes a partial compact player-context candidate before expanded validation", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([{
      id: "partial-player-context",
      match: { schemaId: "starting-region.player-context.v1" },
      result: {
        kind: "schema-invalid",
        value: {
          entity: { name: "Rowan" },
          mechanicalSignals: { attributeDirections: [], skills: [] },
        },
      },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("player-context", {
      request: startingRegionRequestFixture,
      normalized: normalizedRegionConstraintsSchema.parse(outputs.normalize),
      locality: outputs.locality,
      institutions: outputs.institutions,
    })).resolves.toEqual(expect.objectContaining({
      entity: expect.objectContaining({
        id: "generated.actor.player",
        kind: "actor",
        name: "Rowan",
      }),
      socialState: expect.objectContaining({ actorId: "generated.actor.player" }),
      mechanics: expect.objectContaining({
        mechanics: expect.objectContaining({ skills: [expect.any(Object)] }),
      }),
    }));
  });

  it("expands compact NPC proposals into persistent actor state", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([{
      id: "compact-npcs",
      match: { schemaId: "starting-region.npcs.v1" },
      result: {
        kind: "schema-invalid",
        value: [{
          name: "Alice",
          summary: "Rowan's sibling, who noticed something strange after work.",
          simulationReasons: ["family relationship", "supernatural witness"],
          goals: ["Get Rowan home safely."],
          relationshipToPlayer: {
            dimensions: { trust: 0.8, concern: 0.7 },
            salience: 0.9,
            tags: ["family"],
          },
          memories: [{
            summary: "Alice saw blue light behind the loading dock.",
            salience: 0.9,
            tags: ["witnessed", "supernatural"],
          }],
          mechanicallyRelevantConstraints: [{
            summary: "Alice has sustained retail experience.",
          }],
        }],
      },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("npcs", {
      request: startingRegionRequestFixture,
      normalized: normalizedRegionConstraintsSchema.parse(outputs.normalize),
      settlement: outputs.settlement,
      locality: outputs.locality,
      institutions: outputs.institutions,
      playerContext: outputs["player-context"],
    })).resolves.toEqual([
      expect.objectContaining({
        entity: expect.objectContaining({
          id: "generated.actor.alice",
          kind: "actor",
          name: "Alice",
          data: {},
        }),
        socialState: expect.objectContaining({
          actorId: "generated.actor.alice",
          goals: [expect.objectContaining({ description: "Get Rowan home safely." })],
          relationships: [expect.objectContaining({
            targetEntityId: "generated.actor.player",
          })],
          memories: [expect.objectContaining({
            summary: "Alice saw blue light behind the loading dock.",
          })],
        }),
        provenance: expect.objectContaining({ class: "generator-chosen" }),
      }),
    ]);
  });

  it("bounds initial NPC generation to a small densifiable cast", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new OptionsRecordingModelRuntime(new ScriptedModelRuntime([{
      id: "compact-npcs",
      match: { schemaId: "starting-region.npcs.v1" },
      result: { kind: "schema-invalid", value: [{
        name: "Alice",
        summary: "Rowan's sibling, who noticed something strange after work.",
        simulationReasons: ["family relationship", "supernatural witness"],
        goals: ["Get Rowan home safely."],
      }] },
    }]));
    const proposal = createStartingRegionProposalModel(runtime);

    await proposal.propose("npcs", {
      request: startingRegionRequestFixture,
      normalized: normalizedRegionConstraintsSchema.parse(outputs.normalize),
      settlement: outputs.settlement,
      locality: outputs.locality,
      institutions: outputs.institutions,
      playerContext: outputs["player-context"],
    });

    expect(runtime.invocationOptions).toEqual([
      expect.objectContaining({
        generation: { temperature: 0, maxOutputTokens: 1_024 },
      }),
    ]);
  });

  it("recovers a token-truncated NPC stage with a minimal bounded contract", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([
      {
        id: "truncated-npcs",
        match: { schemaId: "starting-region.npcs.v1" },
        result: {
          kind: "failure",
          failureKind: "invalid-output",
          message: "The model reached its output token limit before completing the requested JSON",
        },
      },
      {
        id: "npc-recovery",
        match: { schemaId: "starting-region.npcs.compact-recovery.v1" },
        result: {
          kind: "structured",
          value: [{
            name: "Alice",
            summary: "The residence coordinator who dispatches Rowan's maintenance calls.",
            simulationReasons: ["work contact"],
            goals: ["Keep urgent repairs moving."],
          }],
        },
      },
    ]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("npcs", {
      request: startingRegionRequestFixture,
      normalized: normalizedRegionConstraintsSchema.parse(outputs.normalize),
      settlement: outputs.settlement,
      locality: outputs.locality,
      institutions: outputs.institutions,
      playerContext: outputs["player-context"],
    })).resolves.toEqual([
      expect.objectContaining({
        entity: expect.objectContaining({ name: "Alice" }),
        simulationReasons: ["work contact"],
      }),
    ]);
    expect(runtime.invocations.map((invocation) => invocation.schemaId)).toEqual([
      "starting-region.npcs.v1",
      "starting-region.npcs.compact-recovery.v1",
    ]);
  });

  it("falls back deterministically when even compact NPC recovery is truncated", async () => {
    const outputs = startingRegionStageOutputs();
    const tokenLimitFailure = {
      kind: "failure" as const,
      failureKind: "invalid-output" as const,
      message: "The model reached its output token limit before completing the requested JSON",
    };
    const runtime = new ScriptedModelRuntime([
      {
        id: "truncated-npcs",
        match: { schemaId: "starting-region.npcs.v1" },
        result: tokenLimitFailure,
      },
      {
        id: "truncated-npc-recovery",
        match: { schemaId: "starting-region.npcs.compact-recovery.v1" },
        result: tokenLimitFailure,
      },
    ]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("npcs", {
      request: startingRegionRequestFixture,
      normalized: normalizedRegionConstraintsSchema.parse(outputs.normalize),
      settlement: outputs.settlement,
      locality: outputs.locality,
      institutions: outputs.institutions,
      playerContext: outputs["player-context"],
    })).resolves.toEqual([
      expect.objectContaining({
        entity: expect.objectContaining({ name: "Local Contact" }),
      }),
    ]);
  });

  it("recovers a token-truncated institution stage with a compact proposal", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([
      {
        id: "truncated-institutions",
        match: { schemaId: "starting-region.institutions.v1" },
        result: {
          kind: "failure",
          failureKind: "invalid-output",
          message: "The model reached its output token limit before completing the requested JSON",
        },
      },
      {
        id: "institution-recovery",
        match: { schemaId: "starting-region.institutions.compact-recovery.v1" },
        result: {
          kind: "structured",
          value: [{
            name: "Riverside Transit Office",
            summary: "The small public office coordinating local buses.",
            institutionType: "transit",
            serviceAreaEntityId: outputs.settlement.id,
            goals: ["Keep the town connected."],
            capabilities: ["Dispatch local buses."],
            resources: ["A small bus fleet."],
            constraints: ["Limited drivers."],
            currentPressures: ["Route delays."],
          }],
        },
      },
    ]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("institutions", {
      request: startingRegionRequestFixture,
      region: outputs.region,
      settlement: outputs.settlement,
    })).resolves.toEqual([
      expect.objectContaining({
        entity: expect.objectContaining({ name: "Riverside Transit Office", data: {} }),
        serviceAreaEntityId: outputs.settlement.id,
      }),
    ]);
  });

  it("expands compact pressure proposals into authoritative linked records", async () => {
    const outputs = startingRegionStageOutputs();
    const runtime = new ScriptedModelRuntime([{
      id: "compact-pressures",
      match: { schemaId: "starting-region.pressures.v1" },
      result: {
        kind: "schema-invalid",
        value: {
          pressures: [{
            category: "supernatural",
            summary: "Blue frost appears by the river",
            currentState: "Cold tracks are approaching the neighborhood.",
            cause: "a newly emerged magical predator",
            likelyTrajectory: "The creature reaches busier streets.",
            actorEntityIds: ["generated.actor.alice", "missing.actor"],
            scope: "region",
            changeConditions: ["the tracks are investigated"],
            visibility: "hidden",
          }],
          creatures: [{
            name: "Frost Cat",
            summary: "A territorial predator that steals heat.",
            origin: "transformed-terrestrial-life",
            morphology: "a panther-sized feline with crystalline whiskers",
            behavior: "territorial and cautious",
            corePrinciple: "steals heat from nearby surfaces",
            observedTraits: ["blue frost", "large tracks"],
            nearTermPlayerFacing: true,
            threat: {
              challengeBand: "Hard",
              overallThreat: "Dangerous, readable, and avoidable.",
              signatureCapabilities: ["heat theft"],
              tells: ["its whiskers brighten before heat theft"],
              counterplay: ["break line of sight or introduce heat"],
            },
          }],
          beliefs: [{
            holderActorId: "generated.actor.alice",
            subjectRef: "Frost Cat",
            proposition: "Something supernatural moved behind the loading dock.",
            truthStatus: "true",
            confidence: 0.8,
          }],
        },
      },
    }]);
    const proposal = createStartingRegionProposalModel(runtime);

    await expect(proposal.propose("pressures", {
      request: startingRegionRequestFixture,
      region: outputs.region,
      settlement: outputs.settlement,
      institutions: outputs.institutions,
      locality: outputs.locality,
      playerContext: outputs["player-context"],
      npcs: outputs.npcs,
    })).resolves.toEqual(expect.objectContaining({
      pressures: expect.arrayContaining([
        expect.objectContaining({ category: "ordinary" }),
        expect.objectContaining({ category: "social-institutional" }),
        expect.objectContaining({
          category: "supernatural",
          actorEntityIds: ["generated.actor.alice"],
          scopeId: "scope.generated.region.cascade",
        }),
      ]),
      creatures: [expect.objectContaining({
        entity: expect.objectContaining({
          id: "generated.creature.frost-cat",
          name: "Frost Cat",
        }),
        threatEnvelope: expect.objectContaining({
          challengeBand: "Hard",
          requiredSignatureCapabilities: ["heat theft"],
        }),
      })],
      knowledge: expect.objectContaining({
        facts: expect.arrayContaining([
          expect.objectContaining({ predicate: "pressure.current-state" }),
        ]),
        beliefs: [expect.objectContaining({
          holder: { kind: "actor", id: "generated.actor.alice" },
          subjectId: "generated.creature.frost-cat",
        })],
      }),
      processes: expect.arrayContaining([
        expect.objectContaining({ pressureId: expect.any(String) }),
      ]),
    }));
  });

  it("repairs legacy schema-name scope references when resuming an accepted region", async () => {
    const outputs = startingRegionStageOutputs();
    const model = new DeterministicStartingRegionModel();
    const pressures = outputs.pressures.pressures.map((pressure) => ({
      ...pressure,
      scopeId: pressure.scopeId.includes(".region.")
        ? "starting-region.region.v1"
        : pressure.scopeId.includes(".settlement.")
          ? "starting-region.settlement.v1"
          : "starting-region.locality.v1",
    }));
    const processes = outputs.pressures.processes.map((process) => ({
      ...process,
      scopeId: process.scopeId.includes(".region.")
        ? "starting-region.region.v1"
        : process.scopeId.includes(".settlement.")
          ? "starting-region.settlement.v1"
          : "starting-region.locality.v1",
    }));

    const result = await generateStartingRegion(startingRegionRequestFixture, model, {
      resumeState: startingRegionWorkingStateSchema.parse({
        request: startingRegionRequestFixture,
        normalized: outputs.normalize,
        region: outputs.region,
        settlement: outputs.settlement,
        institutions: outputs.institutions,
        locality: outputs.locality,
        playerContext: outputs["player-context"],
        npcs: outputs.npcs,
        pressures,
        creatures: outputs.pressures.creatures,
        knowledge: outputs.pressures.knowledge,
        processes,
        openingSituation: outputs["opening-situation"],
      }),
    });

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") throw new Error("Expected resumed generation");
    expect(result.seed.pressures.map((pressure) => pressure.scopeId)).toEqual([
      "scope.generated.locality.riverside",
      "scope.generated.settlement.haven",
      "scope.generated.region.cascade",
    ]);
    expect(result.seed.processes.map((process) => process.scopeId)).toEqual([
      "scope.generated.locality.riverside",
      "scope.generated.settlement.haven",
      "scope.generated.region.cascade",
    ]);
    expect(model.calls).toEqual(["audit"]);
  });

  it("deterministically separates reused region, settlement, and locality IDs before audit", async () => {
    const outputs = startingRegionStageOutputs();
    const sharedId = "generated.place.hillbrook";
    const sharedScopeId = `scope.${sharedId}`;
    const pressures = outputs.pressures.pressures.map((pressure) => ({
      ...pressure,
      scopeId: sharedScopeId,
    }));
    const processes = outputs.pressures.processes.map((process) => ({
      ...process,
      scopeId: sharedScopeId,
    }));
    let auditedIds: string[] = [];
    const model = {
      propose() {
        throw new Error("Accepted stages must not be regenerated");
      },
      repair() {
        throw new Error("A deterministic ID collision must not require model repair");
      },
      audit(seed: StartingRegionSeed) {
        auditedIds = [seed.region.id, seed.settlement.id, seed.locality.id];
        return { issues: [] };
      },
    };

    const result = await generateStartingRegion(startingRegionRequestFixture, model, {
      resumeState: startingRegionWorkingStateSchema.parse({
        request: startingRegionRequestFixture,
        normalized: outputs.normalize,
        region: { ...outputs.region, id: sharedId },
        settlement: { ...outputs.settlement, id: sharedId },
        institutions: outputs.institutions.map((institution) => ({
          ...institution,
          serviceAreaEntityId: sharedId,
        })),
        locality: { ...outputs.locality, id: sharedId },
        playerContext: outputs["player-context"],
        npcs: outputs.npcs,
        pressures,
        creatures: outputs.pressures.creatures,
        knowledge: outputs.pressures.knowledge,
        processes,
        openingSituation: {
          ...outputs["opening-situation"],
          ordinaryAnchorEntityIds: [
            ...outputs["opening-situation"].ordinaryAnchorEntityIds,
            sharedId,
          ],
        },
      }),
    });

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") throw new Error("Expected resumed generation");
    expect(new Set(auditedIds).size).toBe(3);
    expect(auditedIds).toEqual([
      sharedId,
      "generated.settlement.haven",
      "generated.locality.riverside",
    ]);
    expect(result.seed.institutions[0]?.serviceAreaEntityId).toBe(
      "generated.settlement.haven",
    );
    expect(result.seed.pressures.map((pressure) => pressure.scopeId)).toEqual([
      "scope.generated.locality.riverside",
      "scope.generated.settlement.haven",
      `scope.${sharedId}`,
    ]);
    expect(result.seed.processes.map((process) => process.scopeId)).toEqual([
      "scope.generated.locality.riverside",
      "scope.generated.settlement.haven",
      `scope.${sharedId}`,
    ]);
    expect(result.seed.openingSituation.ordinaryAnchorEntityIds).toContain(
      "generated.locality.riverside",
    );
  });

  it("minimally grounds a physical workplace while keeping model audit opinions advisory", async () => {
    const outputs = startingRegionStageOutputs();
    const normalized = normalizedRegionConstraintsSchema.parse({
      ...outputs.normalize,
      player: {
        ...outputs.normalize.player,
        establishedFacts: [
          ...outputs.normalize.player.establishedFacts,
          {
            id: "player.fact.clothing-work",
            category: "work-school",
            statement: "works part time at a local clothing store",
            sourceText: "I work part time at a local clothing store.",
          },
          {
            id: "player.fact.games",
            category: "biography",
            statement: "enjoys role-playing games",
            sourceText: "I enjoy role-playing games.",
          },
        ],
      },
    });
    let repairCalls = 0;
    const model = {
      propose() {
        throw new Error("Accepted stages must not be regenerated");
      },
      repair() {
        repairCalls += 1;
        throw new Error("Advisory audit findings must not rewrite accepted stages");
      },
      audit() {
        return {
          issues: [{
            code: "audit.biography.gaming-culture",
            severity: "error" as const,
            message: "The town does not contain a gaming culture for the player's hobby.",
            path: ["locality"],
            repairStageId: "player-context" as const,
          }],
        };
      },
    };

    const result = await generateStartingRegion(startingRegionRequestFixture, model, {
      resumeState: startingRegionWorkingStateSchema.parse({
        request: startingRegionRequestFixture,
        normalized,
        region: outputs.region,
        settlement: outputs.settlement,
        institutions: outputs.institutions,
        locality: outputs.locality,
        playerContext: outputs["player-context"],
        npcs: outputs.npcs,
        pressures: outputs.pressures.pressures,
        creatures: outputs.pressures.creatures,
        knowledge: outputs.pressures.knowledge,
        processes: outputs.pressures.processes,
        openingSituation: outputs["opening-situation"],
      }),
    });

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") throw new Error("Expected resumed generation");
    const clothingStore = result.seed.locality.locations.find((location) =>
      location.name === "Local Clothing Store"
    );
    expect(clothingStore).toBeDefined();
    expect(result.seed.playerContext.routineLocationIds).toContain(clothingStore!.id);
    expect(result.seed.playerContext.accessEntityIds).toContain(clothingStore!.id);
    expect(result.seed.locality.routes).toContainEqual(expect.objectContaining({
      toId: clothingStore!.id,
    }));
    expect(result.seed.locality.locations.some((location) =>
      /gaming|video game/i.test(`${location.name} ${location.summary}`)
    )).toBe(false);
    expect(result.audit.issues).toEqual([
      expect.objectContaining({ severity: "warning" }),
    ]);
    expect(repairCalls).toBe(0);
  });

  it("does not invent a separate school when an accepted locality already contains the player's college", async () => {
    const outputs = startingRegionStageOutputs();
    const normalized = normalizedRegionConstraintsSchema.parse({
      ...outputs.normalize,
      player: {
        ...outputs.normalize.player,
        establishedFacts: [{
          id: "player.fact.college-work",
          category: "work-school",
          statement: "Liam works at Hillbrook College.",
          sourceText: "works at Hillbrook College",
        }],
      },
    });
    const locality = {
      ...outputs.locality,
      locations: outputs.locality.locations.map((location, index) =>
        index === 0
          ? {
              ...location,
              name: "Hillbrook College Dorms",
              summary: "The college dormitory where Liam lives and works.",
            }
          : location
      ),
    };
    const model = new DeterministicStartingRegionModel();

    const result = await generateStartingRegion(startingRegionRequestFixture, model, {
      resumeState: startingRegionWorkingStateSchema.parse({
        request: startingRegionRequestFixture,
        normalized,
        region: outputs.region,
        settlement: outputs.settlement,
        institutions: outputs.institutions,
        locality,
        playerContext: outputs["player-context"],
        npcs: outputs.npcs,
        pressures: outputs.pressures.pressures,
        creatures: outputs.pressures.creatures,
        knowledge: outputs.pressures.knowledge,
        processes: outputs.pressures.processes,
        openingSituation: outputs["opening-situation"],
      }),
    });

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") throw new Error("Expected resumed generation");
    expect(result.seed.locality.locations.some((location) =>
      location.name === "Local School"
    )).toBe(false);
    expect(result.seed.playerContext.currentObligations).not.toContain(
      "Work shifts at Local School.",
    );
  });

  it("accepts faithful source quotations despite model casing and whitespace normalization", () => {
    expect(sourceContainsQuotedText(
      "Most people work at the plant.\nI'm a local.",
      "most people work at the plant",
    )).toBe(true);
    expect(sourceContainsQuotedText(
      "Most people work at the plant.\nI'm a local.",
      "Most   people work at the plant",
    )).toBe(true);
    expect(sourceContainsQuotedText(
      "Most people work at the plant.",
      "The plant employs everyone in town",
    )).toBe(false);
  });

  it("discards invented player facts when generated details are authorized", async () => {
    const outputs = startingRegionStageOutputs();
    const model = new DeterministicStartingRegionModel();
    model.proposals.normalize = {
      ...outputs.normalize,
      player: {
        ...outputs.normalize.player,
        establishedFacts: [
          ...outputs.normalize.player.establishedFacts,
          {
            id: "player-description-1",
            category: "biography",
            statement: "The player has a hobby the generator invented.",
            sourceText: "an invented quotation",
          },
        ],
      },
    };

    const result = await generateStartingRegion(
      { ...startingRegionRequestFixture, allowGeneratedDetails: true },
      model,
    );

    expect(result.kind).toBe("generated");
    if (result.kind !== "generated") throw new Error("Expected generated region");
    expect(result.seed.normalized.player.establishedFacts)
      .not.toContainEqual(expect.objectContaining({ id: "player-description-1" }));
  });

  it("repairs only the invalid stage and compiles a validated playable campaign", async () => {
    const { result, model, definition } = await generatedGame();
    expect(model.calls).toContain("repair:locality");
    expect(model.calls.filter((call) => call === "propose:region")).toHaveLength(1);
    const localityDiagnostic = result.diagnostics.find(
      (item) => item.stageId === "locality",
    );
    expect(localityDiagnostic).toEqual(expect.objectContaining({
      attempts: 2,
      accepted: true,
      attemptHistory: [
        expect.objectContaining({ attempt: 1, accepted: false }),
        expect.objectContaining({ attempt: 2, accepted: true }),
      ],
    }));
    expect(result.seed.normalized.explicitConstraints[0]?.sourceText)
      .toBe(startingRegionRequestFixture.locationDescription);
    expect(result.seed.openingSituation).toEqual(expect.objectContaining({
      combatRequired: false,
      mandatoryQuest: false,
    }));
    expect(result.seed.pressures.map((item) => item.category).sort()).toEqual([
      "ordinary",
      "social-institutional",
      "supernatural",
    ]);
    expect(result.seed.creatures[0]?.threatEnvelope?.challengeBand).toBe("Hard");

    const game = loadGameDefinition(definition);
    expect(game.worldSimulationRegistry.listScopes()).toHaveLength(3);
    expect(game.campaign.generationRecord?.acceptedStageOutputs)
      .toHaveProperty("opening-situation");
  });

  it("repairs a settlement that drifts into generic preindustrial rural fantasy", async () => {
    const outputs = startingRegionStageOutputs();
    const base = new DeterministicStartingRegionModel();
    const model = {
      propose(stageId: string, context: Parameters<typeof base.propose>[1]) {
        const candidate = base.propose(stageId, context);
        if (stageId !== "settlement") return candidate;
        return {
          ...outputs.settlement,
          economy: ["subsistence farming"],
          districts: [{
            id: "district.market-square",
            name: "Market Square",
            summary: "A traditional square surrounded by self-sufficient farmsteads.",
          }],
          transportation: ["dirt paths and a small boat landing"],
          institutionalCapacity: "limited local authority",
          traits: ["traditional", "isolated"],
        };
      },
      repair: base.repair.bind(base),
      audit: base.audit.bind(base),
    };

    const result = await generateStartingRegion(startingRegionRequestFixture, model);

    expect(result.kind).toBe("generated");
    expect(base.calls).toContain("repair:settlement");
    if (result.kind !== "generated") throw new Error("Expected generated region");
    expect(result.seed.settlement.transportation).toContain("interstate");
  });

  it("minimally repairs an accepted legacy seed that has no opening creature", async () => {
    const { result } = await generatedGame(new DeterministicStartingRegionModel());
    const legacySeed = { ...result.seed, creatures: [] };

    const repaired = ensureOpeningCreature(legacySeed);

    expect(repaired.creatures).toHaveLength(1);
    expect(repaired.creatures[0]).toEqual(expect.objectContaining({
      nearTermPlayerFacing: true,
      provenance: expect.objectContaining({
        sourceIds: expect.arrayContaining(["generated.pressure.tracks"]),
      }),
      threatEnvelope: expect.objectContaining({ challengeBand: "Hard" }),
    }));
    expect(repaired.pressures).toStrictEqual(legacySeed.pressures);
    expect(ensureOpeningCreature(repaired)).toBe(repaired);
  });

  it("asks only material follow-ups and enforces the bounded repair ceiling", async () => {
    const needsInput = await generateStartingRegion(
      startingRegionRequestFixture,
      new DeterministicStartingRegionModel({ needsInput: true }),
    );
    expect(needsInput).toEqual(expect.objectContaining({
      kind: "needs-input",
      questions: [expect.objectContaining({
        id: "question.location-scale",
        scope: "region",
      })],
    }));

    const generatedWithoutQuestions = await generateStartingRegion(
      { ...startingRegionRequestFixture, allowGeneratedDetails: true },
      new DeterministicStartingRegionModel({ needsInput: true }),
    );
    expect(generatedWithoutQuestions.kind).toBe("generated");
    if (generatedWithoutQuestions.kind === "generated") {
      expect(generatedWithoutQuestions.seed.normalized.followUpQuestions).toEqual([]);
      expect(generatedWithoutQuestions.seed.normalized.player.followUpQuestions).toEqual([]);
    }

    await expect(generateStartingRegion(
      startingRegionRequestFixture,
      new DeterministicStartingRegionModel({ alwaysFailLocality: true }),
    )).rejects.toBeInstanceOf(GenerationStageError);
  });

  it("initializes only validated content and catches up seeded processes", async () => {
    const { definition } = await generatedGame(
      new DeterministicStartingRegionModel(),
    );
    const game = loadGameDefinition(definition);
    const persistence = createInMemoryPersistence();
    const session = await createGameRuntime(
      runtimeDependencies(persistence, game, "generated"),
    ).createWorld("Generated Haven");
    const initial = session.snapshot();
    expect(initial.entities.find((item) => item.id === "generated.actor.player")?.data)
      .not.toHaveProperty("openingSituation");
    expect(game.campaign.generationRecord?.acceptedStageOutputs)
      .toHaveProperty("opening-situation", expect.objectContaining({
        combatRequired: false,
      }));
    expect(initial.actorSocialStates).toHaveLength(3);
    expect(initial.mechanicalRealizations.find(
      (item) => item.entityId === "generated.creature.frost-cat",
    )?.level).toBe("constrained");
    expect(initial.simulationCursors.some((cursor) =>
      cursor.scopeId.includes("actor")
    )).toBe(false);

    await session.advanceTime(fictionalDurationMs(2 * 24 * 60 * 60 * 1000));
    const caught = await session.catchUpScope({
      scopeId: "scope.generated.locality.riverside",
    });
    expect(caught.kind).toBe("caught-up");
    expect(caught.awakenedScopeIds).toEqual([
      "scope.generated.region.cascade",
      "scope.generated.settlement.haven",
      "scope.generated.locality.riverside",
    ]);
    const state = session.snapshot();
    expect(state.entities.find((item) => item.id === "generated.pressure.rent")
      ?.data["process-value"]).toBe(2);
    expect(state.entities.find((item) => item.id === "generated.pressure.clinic")
      ?.data["process-value"]).toBe(1);
    expect(state.entities.find((item) => item.id === "generated.pressure.tracks")
      ?.data["process-value"]).toBe(0.5);
  });
});

describe("persistent actor social state", () => {
  it("keeps two NPC perspectives distinct, protects private state, and survives SQLite reopen", async () => {
    const { definition } = await generatedGame(
      new DeterministicStartingRegionModel(),
    );
    const game = loadGameDefinition(withSocialOperation(definition));
    const sqlite = await createMigratedSqlitePersistence();
    const dependencies = runtimeDependencies(sqlite.persistence, game, "social");
    const session = await createGameRuntime(dependencies).createWorld("Social state");

    const socialBinding = game.toolCatalog.resolveBinding("knowledge.social.retrieve");
    const alice = await executeEngineQueryTool(
      socialBinding,
      session.snapshot(),
      {},
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.alice" },
          focalActorId: "generated.actor.alice",
        },
      },
    );
    const bob = await executeEngineQueryTool(
      socialBinding,
      session.snapshot(),
      {},
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.bob" },
          focalActorId: "generated.actor.bob",
        },
      },
    );
    expect(alice).toEqual(expect.objectContaining({
      actorId: "generated.actor.alice",
      goals: [expect.objectContaining({ status: "active" })],
      memories: [expect.objectContaining({ id: "memory.alice.blue-light" })],
      commitments: [expect.objectContaining({ availabilityImpact: "occupied" })],
    }));
    expect(bob).toEqual(expect.objectContaining({
      actorId: "generated.actor.bob",
      goals: [expect.objectContaining({ status: "blocked" })],
      memories: [expect.objectContaining({ id: "memory.bob.supply-delay" })],
      commitments: [expect.objectContaining({ availabilityImpact: "unavailable" })],
    }));
    await expect(executeEngineQueryTool(
      socialBinding,
      session.snapshot(),
      { actorId: "generated.actor.bob" },
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.alice" },
          focalActorId: "generated.actor.alice",
        },
      },
    )).rejects.toThrow(/only their own social state/i);

    const knowledgeBinding = game.toolCatalog.resolveBinding("knowledge.facts.retrieve");
    const aliceKnowledge = await executeEngineQueryTool(
      knowledgeBinding,
      session.snapshot(),
      { subjectId: "generated.creature.frost-cat" },
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.alice" },
          focalActorId: "generated.actor.alice",
        },
      },
    );
    const bobKnowledge = await executeEngineQueryTool(
      knowledgeBinding,
      session.snapshot(),
      { subjectId: "generated.creature.frost-cat" },
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.bob" },
          focalActorId: "generated.actor.bob",
        },
      },
    );
    expect(JSON.stringify(aliceKnowledge)).toContain("supernatural moved");
    expect(JSON.stringify(bobKnowledge)).toContain("coolant leak");
    expect(JSON.stringify(aliceKnowledge)).not.toContain("truthStatus");

    await session.executeOperation("rules.actions.change-social-state", {
      actorId: "generated.actor.alice",
    });
    const bobBefore = session.snapshot().actorSocialStates.find(
      (item) => item.actorId === "generated.actor.bob",
    );
    const saved = await session.save("social checkpoint");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    expect(reopened.snapshot().actorSocialStates.find(
      (item) => item.actorId === "generated.actor.alice",
    )?.relationships[0]?.dimensions.trust).toBe(0.7);
    expect(reopened.snapshot().actorSocialStates.find(
      (item) => item.actorId === "generated.actor.bob",
    )).toEqual(bobBefore);
    expect((await sqlite.persistence.saves.loadCheckpoint(saved.checkpointId))?.state
      .actorSocialStates).toEqual(reopened.snapshot().actorSocialStates);
  });
});

describe("mechanical realization and awakening", () => {
  it("densifies a human and creature without retconning, grows the creature, and persists both", async () => {
    const { definition } = await generatedGame(new DeterministicStartingRegionModel());
    const game = loadGameDefinition(definition);
    const sqlite = await createMigratedSqlitePersistence();
    const dependencies = runtimeDependencies(sqlite.persistence, game, "realization");
    const session = await createGameRuntime(dependencies).createWorld("Realization");

    await session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.actor.bob",
      subjectKind: "human",
      targetLevel: "partial",
      mechanics: { attributes: { empathy: 60 } },
      constraints: [],
      stepId: "realization.bob.partial",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "A medical interaction makes empathy mechanically relevant.",
      scopeIds: ["scope.generated.locality.riverside"],
    });
    await expect(session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.actor.bob",
      subjectKind: "human",
      targetLevel: "complete",
      mechanics: humanMechanics(61),
      constraints: [],
      stepId: "realization.bob.retcon",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "Invalid retcon attempt.",
      scopeIds: [],
    })).rejects.toThrow(/retcon/i);
    await session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.actor.bob",
      subjectKind: "human",
      targetLevel: "complete",
      mechanics: humanMechanics(60),
      constraints: [],
      stepId: "realization.bob.complete",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "Authorized mechanics inspection requires the remaining profile.",
      scopeIds: [],
    });

    await session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.creature.frost-cat",
      subjectKind: "creature",
      targetLevel: "partial",
      mechanics: { attributes: { agility: 70 } },
      constraints: [],
      stepId: "realization.frost-cat.partial",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "The encounter needs movement mechanics.",
      scopeIds: ["scope.generated.region.cascade"],
    });
    await expect(session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.creature.frost-cat",
      subjectKind: "creature",
      targetLevel: "complete",
      mechanics: creatureMechanics(71),
      constraints: [],
      stepId: "realization.frost-cat.retcon",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "Invalid creature retcon.",
      scopeIds: [],
    })).rejects.toThrow(/retcon/i);
    await session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.creature.frost-cat",
      subjectKind: "creature",
      targetLevel: "complete",
      mechanics: creatureMechanics(70),
      constraints: [],
      stepId: "realization.frost-cat.complete",
      occurredAt: generatedStart,
      generatorVersion: "test-v1",
      reason: "The full encounter needs complete creature mechanics.",
      scopeIds: [],
    });
    await session.executeOperation("rules.realization.apply-creature-growth", {
      entityId: "generated.creature.frost-cat",
      attributeDeltas: { strength: 2 },
      skillSpDeltas: [{ skillId: "skill.ambush", amount: 3 }],
      reason: "The surviving creature matured over fictional time.",
      scopeIds: ["scope.generated.region.cascade"],
    });

    const saved = await session.save("realized state");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    const state = reopened.snapshot();
    expect(state.mechanicalRealizations.find(
      (item) => item.entityId === "generated.actor.bob",
    )).toEqual(expect.objectContaining({ level: "complete" }));
    expect(state.mechanicalRealizations.find(
      (item) => item.entityId === "generated.creature.frost-cat",
    )).toEqual(expect.objectContaining({ level: "complete" }));
    expect((state.entities.find(
      (item) => item.id === "generated.creature.frost-cat",
    )?.data.mechanics as { attributes: { strength: number } }).attributes.strength)
      .toBe(62);
    expect((await sqlite.persistence.saves.loadCheckpoint(saved.checkpointId))?.state
      .mechanicalRealizations).toEqual(state.mechanicalRealizations);
  });

  it("persists the opening contract and performs a legal first awakening", async () => {
    const { definition } = await generatedGame(new DeterministicStartingRegionModel());
    const game = loadGameDefinition(definition);
    const sqlite = await createMigratedSqlitePersistence();
    const dependencies = runtimeDependencies(sqlite.persistence, game, "awakening");
    const session = await createGameRuntime(dependencies).createWorld("Awakening");
    const power = {
      id: "power.sheltering-fold",
      name: "Sheltering Fold",
      corePrinciple: "fold nearby space to interpose a brief protective boundary",
      characterLevelAtManifestation: 1,
      manifestationStrength: 1,
      growthProfile: "hybrid",
      pp: 5,
      powerLevel: 1,
      functions: [{
        id: "power-function.shelter",
        name: "Shelter",
        description: "Interpose a short-lived local spatial barrier.",
        manaCost: 10,
        activationTimeMs: 500,
        conditions: ["a visible nearby person or space"],
        targets: ["one nearby person"],
        limits: ["brief duration", "local scale"],
      }],
      developmentAxes: ["duration", "area", "precision"],
      tags: [
        "domain.space",
        "operation.create",
        "target.area",
        "shape.active",
        "role.defense",
      ],
      discoveredBehaviors: [],
      committedMilestones: [],
      balanceRationale: "One narrow protective function with visible limits.",
    };
    const result = await session.executeOperation(
      "rules.progression.manifest-first-power",
      {
        actorId: "generated.actor.player",
        power,
        skillAllocations: [{
          skillId: "skill.customer-service",
          amount: 5,
          evidenceEventIds: ["opening.shared-danger"],
        }],
        scopeIds: ["scope.generated.locality.riverside"],
        causedByEventIds: [],
        reason: "Rowan manifests protection while shielding Alice.",
      },
    );
    expect(result).toEqual(expect.objectContaining({
      characterLevel: 1,
      characterXp: 2,
      powerId: "power.sheltering-fold",
      skillPointsAllocated: 5,
    }));
    const mechanics = rulesActorStateSchema.parse(session.snapshot().entities.find(
      (item) => item.id === "generated.actor.player",
    )?.data.mechanics);
    expect(mechanics.progression.powers).toEqual([power]);
    expect(mechanics.progression.mana).toEqual({ current: 108, max: 108 });
    expect(mechanics.skills[0]?.sp).toBe(55);

    await session.executeOperation("rules.progression.record-power-discovery", {
      actorId: "generated.actor.player",
      powerId: "power.sheltering-fold",
      behavior: {
        id: "power-behavior.sheltering-fold.angled-surface",
        question: "Can the fold be interposed along an angled visible surface?",
        outcome: "valid",
        ruling:
          "The protective fold may align to an angled visible surface as long as it remains local and short-lived.",
        establishedBy: "experiment",
        evidenceEventIds: ["opening.shared-danger"],
      },
      scopeIds: ["scope.generated.locality.riverside"],
      causedByEventIds: [],
      reason: "Rowan tested the fold against an angled loading-dock door.",
    });

    const saved = await session.save("power discovery");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    const reopenedMechanics = rulesActorStateSchema.parse(
      reopened.snapshot().entities.find(
        (item) => item.id === "generated.actor.player",
      )?.data.mechanics,
    );
    expect(reopenedMechanics.progression.powers?.[0]?.tags).toContain("domain.space");
    expect(reopenedMechanics.progression.powers?.[0]?.discoveredBehaviors)
      .toContainEqual(expect.objectContaining({
        id: "power-behavior.sheltering-fold.angled-surface",
        outcome: "valid",
      }));
    expect((await sqlite.persistence.saves.loadCheckpoint(saved.checkpointId))?.state)
      .toEqual(reopened.snapshot());
    expect((await reopened.eventHistory()).at(-1)?.type)
      .toBe("rules.power-behavior-discovered");
  });
});

describe("lazy generated detail", () => {
  it("densifies entities and promotes people without contradicting observations", () => {
    const existing = {
      id: "generated.location.cafe",
      kind: "location",
      name: "Corner Cafe",
      summary: "A quiet neighborhood cafe.",
      data: { district: "Riverside", open: true },
    };
    const densified = densifyGeneratedEntity(existing, {
      entityId: existing.id,
      candidateData: {
        district: "Riverside",
        open: true,
        "owner-name": "Mara",
        layout: "two rooms and a rear kitchen",
      },
      requiredPaths: ["owner-name", "layout"],
      provenance: {
        class: "later-densification",
        sourceIds: [existing.id],
        rationale: "The player entered and asked for the owner.",
      },
    });
    expect(densified.entity.data).toEqual(expect.objectContaining({
      "owner-name": "Mara",
      "densification-history": [expect.objectContaining({
        requiredPaths: ["owner-name", "layout"],
      })],
    }));
    expect(() => densifyGeneratedEntity(existing, {
      entityId: existing.id,
      candidateData: { district: "Downtown", open: true },
      requiredPaths: ["district"],
      provenance: {
        class: "later-densification",
        sourceIds: [existing.id],
        rationale: "Invalid rewrite.",
      },
    })).toThrow(/retcon/i);

    const promoted = promoteObservedPerson({
      id: "observation.cashier",
      summary: "A tired cashier wore a red apron.",
      resolution: "ephemeral",
      establishedData: { apronColor: "red", demeanor: "tired" },
      provenance: {
        class: "generator-chosen",
        sourceIds: ["generated.location.grocery"],
        rationale: "Observed in the grocery scene.",
      },
    }, {
      entity: {
        id: "generated.actor.cashier",
        kind: "actor",
        name: "Mara",
        summary: "A grocery cashier finishing a long shift.",
        data: { apronColor: "red", demeanor: "tired", occupation: "cashier" },
      },
      targetResolution: "persistent",
      resolutionStep: {
        id: "resolution.cashier.persistent",
        level: "persistent",
        establishedAt: generatedStart,
        provenance: {
          class: "later-densification",
          sourceIds: ["observation.cashier"],
          rationale: "Repeated interaction makes identity worth persisting.",
        },
      },
      socialState: {
        actorId: "generated.actor.cashier",
        goals: [],
        relationships: [],
        memories: [],
        commitments: [],
      },
    });
    expect(promoted.mutations.map((item) => item.kind)).toEqual([
      "add-entity",
      "ensure-actor-social-state",
    ]);
    expect(() => promoteObservedPerson({
      id: "observation.cashier",
      summary: "A cashier wore a red apron.",
      resolution: "ephemeral",
      establishedData: { apronColor: "red" },
      provenance: {
        class: "generator-chosen",
        sourceIds: ["generated.location.grocery"],
        rationale: "Observed.",
      },
    }, {
      entity: {
        id: "generated.actor.cashier",
        kind: "actor",
        name: "Mara",
        summary: "A cashier.",
        data: { apronColor: "blue" },
      },
      targetResolution: "identified",
      resolutionStep: {
        id: "resolution.cashier.identified",
        level: "identified",
        establishedAt: generatedStart,
        provenance: {
          class: "later-densification",
          sourceIds: ["observation.cashier"],
          rationale: "Invalid rewrite.",
        },
      },
    })).toThrow(/contradicts an established observation/i);
  });
});
