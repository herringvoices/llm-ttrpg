import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  executeEngineQueryTool,
  fictionalDurationMs,
  loadGameDefinition,
  type ExecutableIntent,
  type GameDefinition,
  type ModelInvocationOptions,
  type ModelRuntime,
  type ModelRuntimeCapabilities,
  type StructuredModelRequest,
  type StructuredModelResult,
  type TextModelRequest,
  type TextModelResult,
} from "@llm-ttrpg/engine";
import {
  ATTRIBUTE_IDS,
  INVINCIBLE_ACTIVE_STATUS_ID,
  INVINCIBLE_PASSIVE_STATUS_ID,
  OpeningIncidentValidationError,
  generateStartingRegion,
  invinciblePower,
  mapAwakeningEarthMagicalInteraction,
  openingBriefFromCampaign,
  realizeOpeningIncidentCampaign,
  referenceGameDefinition,
  referenceSceneSource,
  requestOpeningIncidentProposal,
  resolveActionInputSchema,
  rulesActorStateSchema,
  rulesCreatureStateSchema,
  type OpeningIncidentProposal,
  type ResolveActionInput,
  type ResolveActionResult,
} from "@llm-ttrpg/reference-game";
import { createMigratedSqlitePersistence } from "../../../tests/support/sqlite.js";
import {
  DeterministicStartingRegionModel,
  generatedStart,
  startingRegionRequestFixture,
} from "./starting-region-fixture.js";

class ScriptedModelRuntime implements ModelRuntime {
  readonly capabilities: ModelRuntimeCapabilities = {
    structuredOutput: true,
    streamingText: false,
  };
  readonly requests: Array<TextModelRequest | StructuredModelRequest<unknown>> = [];

  constructor(private readonly structuredAnswer: unknown) {}

  generate(
    request: TextModelRequest,
    options?: ModelInvocationOptions,
  ): Promise<TextModelResult>;
  generate<T>(
    request: StructuredModelRequest<T>,
    options?: ModelInvocationOptions,
  ): Promise<StructuredModelResult<T>>;
  async generate<T>(
    request: TextModelRequest | StructuredModelRequest<T>,
    _options?: ModelInvocationOptions,
  ): Promise<TextModelResult | StructuredModelResult<T>> {
    this.requests.push(request as TextModelRequest | StructuredModelRequest<unknown>);
    const metadata = { runtimeId: "scripted-integration", elapsedMs: 0 };
    if (request.output.kind === "text") {
      return {
        ok: true,
        output: {
          kind: "text",
          text: "Narration claims nothing beyond the already committed results.",
        },
        metadata,
      };
    }
    return {
      ok: true,
      output: {
        kind: "structured",
        value: request.output.schema.parse(this.structuredAnswer),
      },
      metadata,
    };
  }
}

function runtimeDependencies(
  game: ReturnType<typeof loadGameDefinition>,
  persistence = createInMemoryPersistence(),
  prefix = "integration",
) {
  let id = 0;
  return {
    persistence,
    game,
    wallClock: { now: () => "2041-05-01T15:00:00.000Z" },
    idGenerator: { next: (kind: string) => `${kind}.${prefix}-${++id}` },
    worldSeedSource: { nextSeed: () => 0x1818_1818 },
    context: { sceneSource: referenceSceneSource },
  };
}

function refFor(
  context: { diagnostics: { localReferences: Record<string, string> } },
  canonicalId: string,
): string {
  const found = Object.entries(context.diagnostics.localReferences).find(
    ([, id]) => id === canonicalId,
  )?.[0];
  if (!found) throw new Error(`Missing local ref for ${canonicalId}`);
  return found;
}

function proposalFor(
  context: { diagnostics: { localReferences: Record<string, string> } },
  threatEnvelope: unknown,
): OpeningIncidentProposal {
  return {
    incident: {
      id: "generated.incident.loading-dock-frost",
      name: "Loading Dock Frost Incident",
      summary:
        "Blue frost spreads across the grocery loading dock as the nearby magical predator emerges.",
      locationRef: refFor(context, "generated.location.grocery"),
      involvedRefs: [
        refFor(context, "generated.actor.player"),
        refFor(context, "generated.actor.alice"),
        refFor(context, "generated.creature.frost-cat"),
      ],
      groundingRefs: [
        refFor(context, "generated.location.grocery"),
        refFor(context, "generated.actor.alice"),
        refFor(context, "generated.creature.frost-cat"),
      ],
      contactObject: {
        id: "generated.object.loading-dock-bat",
        name: "Loading Dock Bat",
        summary: "An ordinary wooden bat Rowan can directly wield.",
        wielderRef: refFor(context, "generated.actor.player"),
      },
      observedFacts: [{
        id: "generated.fact.loading-dock-frost-visible",
        predicate: "incident.observable-condition",
        value: "blue frost is spreading across the loading dock",
        visibility: "public",
        tags: ["incident", "observation", "frost"],
      }],
    },
    creature: {
      entityRef: refFor(context, "generated.creature.frost-cat"),
      deliberateNearTermPlayerFacing: true,
      threatEnvelope: threatEnvelope as OpeningIncidentProposal["creature"]["threatEnvelope"],
      observedTraits: ["large tracks", "blue frost"],
    },
    publicResponse: {
      institutionId: "generated.institution.haven-public-response",
      institutionName: "Haven Public Supernatural Response",
      responseId: "generated.response.loading-dock-frost",
      observedThreat: "A weak magical predator is active at Riverside Grocery.",
      reportedAt: generatedStart,
      responsibleDispatch: "Haven emergency dispatch",
      responderAssignment: "Municipal supernatural-response unit 2",
      dispatchDelayMs: 2 * 60_000,
      travelDurationMs: 8 * 60_000,
      onSceneDurationMs: 10 * 60_000,
      finalStatus: "contained",
    },
    gateFixture: {
      gateId: "generated.spatial-anomaly.riverside-pocket",
      gateName: "Riverside Pocket Entrance",
      entranceRef: refFor(context, "generated.location.grocery"),
      interiorId: "generated.location.riverside-pocket",
      interiorName: "Riverside Pocket Interior",
      routeFactId: "generated.fact.riverside-pocket-route",
      stabilityFactId: "generated.fact.riverside-pocket-stability",
      scopeId: "scope.generated.riverside-pocket",
      summary: "A small stable spatial anomaly used to prove ordinary composition.",
    },
  };
}

function compactProposalFor(proposal: OpeningIncidentProposal) {
  return {
    incident: {
      name: proposal.incident.name,
      summary: proposal.incident.summary,
      locationRef: proposal.incident.locationRef,
      involvedRefs: proposal.incident.involvedRefs,
      groundingRefs: proposal.incident.groundingRefs,
      contactObject: {
        name: proposal.incident.contactObject.name,
        summary: proposal.incident.contactObject.summary,
        wielderRef: proposal.incident.contactObject.wielderRef,
      },
      observedCondition: String(proposal.incident.observedFacts[0]!.value),
    },
    creature: {
      entityRef: proposal.creature.entityRef,
      observedTraits: proposal.creature.observedTraits,
    },
    publicResponse: {
      institutionName: proposal.publicResponse.institutionName,
      observedThreat: proposal.publicResponse.observedThreat,
      responsibleDispatch: proposal.publicResponse.responsibleDispatch,
      responderAssignment: proposal.publicResponse.responderAssignment,
      finalStatus: proposal.publicResponse.finalStatus,
    },
    ...(proposal.gateFixture
      ? {
          gateFixture: {
            gateName: proposal.gateFixture.gateName,
            entranceRef: proposal.gateFixture.entranceRef,
            interiorName: proposal.gateFixture.interiorName,
            summary: proposal.gateFixture.summary,
          },
        }
      : {}),
  };
}

function allAttributes(value: number) {
  return Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, value]));
}

function creatureMechanics() {
  return rulesCreatureStateSchema.parse({
    attributes: allAttributes(45),
    skills: [{
      id: "skill.frost-cat-pounce",
      name: "Frost Cat Pounce",
      description: "Explosive predatory movement and close physical pressure.",
      specificity: 2,
      sp: 32,
    }],
    stress: { injury: 0, fear: 0, anger: 0, exhaustion: 0, insecurity: 0 },
    statuses: [],
    isPlayerCharacter: false,
  });
}

function plan(
  attributeId: "strength" | "agility",
): ResolveActionInput["performance"] {
  return {
    attributeIds: [attributeId],
    applicableSkillIds: [],
    attributeModifiers: [],
    performanceModifiers: [],
    helpers: [],
    maxUsefulHelpers: 0,
    combinedAttributeContributions: [],
  };
}

function action(
  id: string,
  actorId: string,
  targetId: string,
  overrides: Partial<ResolveActionInput> = {},
): ResolveActionInput {
  return resolveActionInputSchema.parse(JSON.parse(JSON.stringify({
    declaredActionId: id,
    actorId,
    approach: "apply the declared effect",
    feasibility: { status: "feasible" },
    performance: plan("strength"),
    resistance: {
      kind: "fixed",
      value: 1,
      provenance: {
        kind: "authored",
        description: "Deterministic first-slice interaction threshold.",
      },
    },
    effect: { mode: "fixed", potentialEffect: 1 },
    stressConsequence: {
      targetId,
      track: "injury",
      normallyFatal: false,
      pcDeathConsent: false,
    },
    timeToMaterialEffectMs: 250,
    scopeIds: ["scope.generated.locality.riverside"],
    ...overrides,
  })));
}

function intent(actorId: string, targetId: string): ExecutableIntent {
  return {
    actorId,
    goal: "resolve one first-slice interaction",
    targetIds: [targetId],
    requestedHorizonMs: fictionalDurationMs(5_000),
    pressureLevel: 9,
    authorizedHorizonMs: fictionalDurationMs(5_000),
    wasNarrowed: false,
  };
}

describe("Awakening Earth reference-game integration", () => {
  it("uses one structured proposal contract and rejects retcons atomically", async () => {
    const generated = await generateStartingRegion(
      startingRegionRequestFixture,
      new DeterministicStartingRegionModel(),
    );
    if (generated.kind !== "generated") throw new Error("Expected generated region");
    const originalCampaign = JSON.stringify(generated.campaign);
    const baseDefinition: GameDefinition = {
      ...referenceGameDefinition,
      campaign: generated.campaign,
    };
    const baseGame = loadGameDefinition(baseDefinition);
    const baseSession = await createGameRuntime(
      runtimeDependencies(baseGame),
    ).createWorld("Protected opening brief");
    const worldBefore = baseSession.snapshot();
    const context = baseSession.assembleContext({
      role: "orchestrator",
      perspective: { kind: "canonical" },
      budget: { maxUnits: 50_000 },
    });
    expect(worldBefore.entities.find((item) => item.id === "generated.actor.player")?.data)
      .not.toHaveProperty("openingSituation");
    expect(worldBefore.entities.some((item) =>
      item.id === "generated.incident.loading-dock-frost"
    )).toBe(false);
    const proposal = proposalFor(
      context,
      generated.seed.creatures[0]!.threatEnvelope!,
    );
    const compactProposal = compactProposalFor(proposal);
    compactProposal.creature.entityRef = "local.missing-creature";
    const model = new ScriptedModelRuntime(compactProposal);
    const requested = await requestOpeningIncidentProposal({
      modelRuntime: model,
      context,
      campaign: generated.campaign,
      openingBrief: openingBriefFromCampaign(generated.campaign),
    });
    expect(requested).toEqual(expect.objectContaining({
      incident: expect.objectContaining({
        name: proposal.incident.name,
        locationRef: proposal.incident.locationRef,
      }),
      creature: expect.objectContaining({
        entityRef: proposal.creature.entityRef,
        threatEnvelope: proposal.creature.threatEnvelope,
      }),
      publicResponse: expect.objectContaining({
        reportedAt: generated.campaign.startTime,
        finalStatus: proposal.publicResponse.finalStatus,
      }),
    }));
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]?.output.kind).toBe("structured");

    const retcon = structuredClone(requested);
    retcon.creature.threatEnvelope.challengeBand = "Routine";
    expect(() => realizeOpeningIncidentCampaign({
      campaign: generated.campaign,
      setting: referenceGameDefinition.setting,
      world: worldBefore,
      context,
      proposal: retcon,
    })).toThrow(OpeningIncidentValidationError);
    expect(JSON.stringify(generated.campaign)).toBe(originalCampaign);
    expect(baseSession.snapshot()).toEqual(worldBefore);
  });

  it("runs the complete generated incident, rules, response, context, and persistence thread", async () => {
    const generated = await generateStartingRegion(
      startingRegionRequestFixture,
      new DeterministicStartingRegionModel(),
    );
    if (generated.kind !== "generated") throw new Error("Expected generated region");
    const baseGame = loadGameDefinition({
      ...referenceGameDefinition,
      campaign: generated.campaign,
    });
    const baseSession = await createGameRuntime(
      runtimeDependencies(baseGame),
    ).createWorld("Incident proposal context");
    const context = baseSession.assembleContext({
      role: "orchestrator",
      perspective: { kind: "canonical" },
      budget: { maxUnits: 50_000 },
    });
    const proposal = proposalFor(
      context,
      generated.seed.creatures[0]!.threatEnvelope!,
    );
    const campaign = realizeOpeningIncidentCampaign({
      campaign: generated.campaign,
      setting: referenceGameDefinition.setting,
      world: baseSession.snapshot(),
      context,
      proposal,
    });
    const game = loadGameDefinition({ ...referenceGameDefinition, campaign });
    const sqlite = await createMigratedSqlitePersistence();
    const dependencies = runtimeDependencies(game, sqlite.persistence, "thread");
    const session = await createGameRuntime(dependencies)
      .createWorld("Awakening Earth vertical thread");

    const initial = session.snapshot();
    const initialPlayer = rulesActorStateSchema.parse(initial.entities.find(
      (item) => item.id === "generated.actor.player",
    )?.data.mechanics);
    expect(initialPlayer.progression.characterLevel).toBe(0);
    expect(initialPlayer.progression.powers).toEqual([]);
    expect(initial.entities.find((item) => item.id === "generated.creature.frost-cat")?.data)
      .not.toHaveProperty("mechanics");
    expect(initial.mechanicalRealizations.find((item) =>
      item.entityId === "generated.creature.frost-cat"
    )).toEqual(expect.objectContaining({
      level: "constrained",
      constraints: expect.arrayContaining([
        expect.objectContaining({ sourceKind: "threat-envelope" }),
      ]),
    }));
    expect(initial.entities.find((item) =>
      item.id === proposal.publicResponse.responseId
    )?.data["response-state"]).toEqual(expect.objectContaining({
      status: "reported",
      responderAssignment: proposal.publicResponse.responderAssignment,
    }));

    await session.executeOperation("rules.actions.traverse-route", {
      actorId: "generated.actor.player",
      routeFactId: "generated.fact.route-1",
      fromLocationId: "generated.location.apartment",
      toLocationId: "generated.location.grocery",
      travelDurationMs: 10 * 60_000,
      scopeIds: ["scope.generated.locality.riverside"],
    });
    await session.executeOperation("rules.actions.traverse-route", {
      actorId: "generated.actor.player",
      routeFactId: proposal.gateFixture!.routeFactId,
      fromLocationId: "generated.location.grocery",
      toLocationId: proposal.gateFixture!.interiorId,
      travelDurationMs: 1_000,
      scopeIds: [proposal.gateFixture!.scopeId],
    });
    expect(session.snapshot().facts.find((item) =>
      item.id === "state.fact.location.generated.actor.player"
    )?.value).toBe(proposal.gateFixture!.interiorId);
    expect(game.worldSimulationRegistry.getScope(proposal.gateFixture!.scopeId).kind)
      .toBe("campaign-pocket-environment");
    await session.executeOperation("rules.actions.traverse-route", {
      actorId: "generated.actor.player",
      routeFactId: proposal.gateFixture!.routeFactId,
      fromLocationId: proposal.gateFixture!.interiorId,
      toLocationId: "generated.location.grocery",
      travelDurationMs: 1_000,
      scopeIds: [proposal.gateFixture!.scopeId],
    });

    await session.executeOperation("rules.progression.manifest-first-power", {
      actorId: "generated.actor.player",
      power: invinciblePower,
      skillAllocations: [{
        skillId: "skill.customer-service",
        amount: 5,
        evidenceEventIds: [`${proposal.incident.id}.realized`],
      }],
      scopeIds: ["scope.generated.locality.riverside"],
      causedByEventIds: [`${proposal.incident.id}.realized`],
      reason: "Rowan awakens while protecting Alice during the generated incident.",
    });
    let player = rulesActorStateSchema.parse(session.snapshot().entities.find(
      (item) => item.id === "generated.actor.player",
    )?.data.mechanics);
    expect(player.statuses.find((status) =>
      status.id === INVINCIBLE_PASSIVE_STATUS_ID
    )?.derivedAttributeBonuses).toEqual([
      expect.objectContaining({ attributeId: "durability", amount: 4 }),
      expect.objectContaining({ attributeId: "strength", amount: 2 }),
    ]);

    await session.executeOperation("rules.realization.realize-mechanics", {
      entityId: "generated.creature.frost-cat",
      subjectKind: "creature",
      targetLevel: "complete",
      mechanics: creatureMechanics(),
      constraints: [],
      stepId: "realization.frost-cat.first-incident",
      occurredAt: session.snapshot().fictionalTime,
      generatorVersion: "integration-fixture-v1",
      reason: "The first actual rules interaction now requires exact mechanics.",
      scopeIds: ["scope.generated.locality.riverside"],
    });
    expect(session.snapshot().mechanicalRealizations.find((item) =>
      item.entityId === "generated.creature.frost-cat"
    )).toEqual(expect.objectContaining({
      level: "complete",
      constraints: expect.arrayContaining([
        expect.objectContaining({ sourceKind: "threat-envelope" }),
      ]),
    }));

    const mundaneBullet = mapAwakeningEarthMagicalInteraction(
      { world: session.snapshot(), settingFacts: game.setting.content.facts },
      {
        action: action(
          "action.mundane-bullet",
          "generated.actor.player",
          "generated.creature.frost-cat",
        ),
        targetId: "generated.creature.frost-cat",
        source: "mundane",
        contact: "ranged",
        effect: "direct-material-bodily-harm",
      },
    );
    const bullet = await session.resolve<ResolveActionResult>({
      intent: intent("generated.actor.player", "generated.creature.frost-cat"),
      operation: { id: "rules.actions.resolve-action", input: mundaneBullet },
    });
    expect(bullet.path).toBe("impossible");
    expect(bullet.result.stressChanges).toEqual([]);

    const awakenedBodyStrike = mapAwakeningEarthMagicalInteraction(
      { world: session.snapshot(), settingFacts: game.setting.content.facts },
      {
        action: action(
          "action.awakened-body-strike",
          "generated.actor.player",
          "generated.creature.frost-cat",
        ),
        targetId: "generated.creature.frost-cat",
        source: "awakened-body",
        contact: "direct-contact",
        effect: "direct-material-bodily-harm",
      },
    );
    const bodyStrike = await session.resolve<ResolveActionResult>({
      intent: intent("generated.actor.player", "generated.creature.frost-cat"),
      operation: { id: "rules.actions.resolve-action", input: awakenedBodyStrike },
    });
    expect(bodyStrike.path).not.toBe("impossible");
    expect(bodyStrike.result.stressChanges).toEqual([
      expect.objectContaining({ track: "injury", after: 1 }),
    ]);

    const heldStrike = mapAwakeningEarthMagicalInteraction(
      { world: session.snapshot(), settingFacts: game.setting.content.facts },
      {
        action: action(
          "action.awakened-held-bat",
          "generated.actor.player",
          "generated.creature.frost-cat",
        ),
        targetId: "generated.creature.frost-cat",
        source: "ordinary-wielded-object",
        contact: "direct-contact",
        effect: "direct-material-bodily-harm",
        objectId: proposal.incident.contactObject.id,
      },
    );
    const held = await session.resolve<ResolveActionResult>({
      intent: intent("generated.actor.player", "generated.creature.frost-cat"),
      operation: { id: "rules.actions.resolve-action", input: heldStrike },
    });
    expect(held.path).not.toBe("impossible");
    expect(held.result.stressChanges).toEqual([
      expect.objectContaining({ track: "injury", after: 2 }),
    ]);
    expect(held.basis).toHaveProperty(
      "resistance.provenance.sourceIds",
      expect.arrayContaining([
        "setting.fact.magical-resistance",
        "setting.fact.wielded-object-empowerment",
      ]),
    );

    const released = mapAwakeningEarthMagicalInteraction(
      { world: session.snapshot(), settingFacts: game.setting.content.facts },
      {
        action: action(
          "action.awakened-released-object",
          "generated.actor.player",
          "generated.creature.frost-cat",
        ),
        targetId: "generated.creature.frost-cat",
        source: "ordinary-wielded-object",
        contact: "released-projectile",
        effect: "direct-material-bodily-harm",
        objectId: proposal.incident.contactObject.id,
      },
    );
    const releasedResult = await session.resolve<ResolveActionResult>({
      intent: intent("generated.actor.player", "generated.creature.frost-cat"),
      operation: { id: "rules.actions.resolve-action", input: released },
    });
    expect(releasedResult.path).toBe("impossible");
    expect(releasedResult.basis).toHaveProperty(
      "resistance.provenance.sourceIds",
      expect.arrayContaining(["setting.fact.ranged-empowerment-dissipates"]),
    );

    const mundaneDisplacement = mapAwakeningEarthMagicalInteraction(
      { world: session.snapshot(), settingFacts: game.setting.content.facts },
      {
        action: action(
          "action.mundane-displacement",
          "generated.actor.player",
          "generated.creature.frost-cat",
          { stressConsequence: undefined },
        ),
        targetId: "generated.creature.frost-cat",
        source: "mundane",
        contact: "direct-contact",
        effect: "displacement",
      },
    );
    const displacedCreature = await session.resolve<ResolveActionResult>({
      intent: intent("generated.actor.player", "generated.creature.frost-cat"),
      operation: {
        id: "rules.actions.resolve-action",
        input: mundaneDisplacement,
      },
    });
    expect(displacedCreature.path).not.toBe("impossible");
    expect(displacedCreature.result.realizedEffect).toBe(1);

    await session.executeOperation("rules.progression.activate-invincible", {
      actorId: "generated.actor.player",
      scopeIds: ["scope.generated.locality.riverside"],
      causedByEventIds: [],
    });
    player = rulesActorStateSchema.parse(session.snapshot().entities.find(
      (item) => item.id === "generated.actor.player",
    )?.data.mechanics);
    expect(player.progression.mana?.current).toBe(83);
    expect(player.statuses.some((status) =>
      status.id === INVINCIBLE_ACTIVE_STATUS_ID
    )).toBe(true);

    const creatureInjury = action(
      "action.creature-injury-vs-invincible",
      "generated.creature.frost-cat",
      "generated.actor.player",
      { performance: plan("agility") },
    );
    const blocked = await session.resolve<ResolveActionResult>({
      intent: intent("generated.creature.frost-cat", "generated.actor.player"),
      operation: { id: "rules.actions.resolve-action", input: {
        ...creatureInjury,
        stressConsequence: {
          ...creatureInjury.stressConsequence!,
          consequenceKind: "external-physical-bodily-injury",
        },
      } },
    });
    expect(blocked.result.stressChanges).toEqual([]);
    expect(blocked.result.preventedConsequences).toEqual([
      expect.objectContaining({ sourceStatusId: INVINCIBLE_ACTIVE_STATUS_ID }),
    ]);
    const displacement = await session.resolve<ResolveActionResult>({
      intent: intent("generated.creature.frost-cat", "generated.actor.player"),
      operation: {
        id: "rules.actions.resolve-action",
        input: action(
          "action.creature-displaces-invincible",
          "generated.creature.frost-cat",
          "generated.actor.player",
          { performance: plan("strength"), stressConsequence: undefined },
        ),
      },
    });
    expect(displacement.result.realizedEffect).toBe(1);
    expect(displacement.result.preventedConsequences).toEqual([]);

    await session.executeOperation("rules.actions.traverse-route", {
      actorId: "generated.actor.player",
      routeFactId: "generated.fact.route-1",
      fromLocationId: "generated.location.grocery",
      toLocationId: "generated.location.apartment",
      travelDurationMs: 10 * 60_000,
      scopeIds: ["scope.generated.locality.riverside"],
    });
    await session.advanceTime(fictionalDurationMs(40 * 60_000));
    const caught = await session.catchUpScope({
      scopeId: "scope.generated.locality.riverside",
    });
    expect(caught.kind).toBe("caught-up");
    const afterResponse = session.snapshot();
    expect(afterResponse.entities.find((item) =>
      item.id === proposal.publicResponse.responseId
    )?.data["response-state"]).toEqual(expect.objectContaining({
      status: "contained",
      locationId: "generated.location.grocery",
      reportedAt: generatedStart,
    }));
    expect(afterResponse.facts.find((item) =>
      item.id === "state.fact.location.generated.actor.player"
    )?.value).toBe("generated.location.apartment");
    expect(afterResponse.facts.filter((item) =>
      item.subjectId === proposal.publicResponse.responseId &&
      item.predicate === "public-response.status"
    )).toEqual([
      expect.objectContaining({ value: "contained" }),
    ]);

    const knowledgeBinding = game.toolCatalog.resolveBinding(
      "knowledge.facts.retrieve",
    );
    const responseKnowledge = await executeEngineQueryTool(
      knowledgeBinding,
      afterResponse,
      { subjectId: proposal.publicResponse.responseId },
      {
        authorization: {
          role: "actor",
          perspective: { kind: "actor", id: "generated.actor.player" },
          focalActorId: "generated.actor.player",
        },
      },
    );
    expect(JSON.stringify(responseKnowledge)).toContain("contained");
    expect((await session.eventHistory()).some((event) =>
      event.type === "campaign.public-response-advanced"
    )).toBe(true);
    const laterContext = session.assembleContext({
      role: "orchestrator",
      perspective: { kind: "canonical" },
      budget: { maxUnits: 50_000 },
    });
    expect(Object.values(laterContext.diagnostics.localReferences)).toEqual(
      expect.arrayContaining([
        proposal.incident.id,
        proposal.publicResponse.responseId,
      ]),
    );
    expect(JSON.stringify(laterContext)).toContain("contained");

    const stateBeforeNarration = session.snapshot();
    const narrator = new ScriptedModelRuntime({});
    await narrator.generate({
      prompt: {
        instructions: ["Narrate only committed results."],
        input: "Describe what happened.",
      },
      output: { kind: "text" },
    });
    expect(session.snapshot()).toEqual(stateBeforeNarration);

    const saved = await session.save("integrated thread");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    expect(reopened.snapshot()).toEqual(session.snapshot());
    expect((await sqlite.persistence.saves.loadCheckpoint(saved.checkpointId))?.state)
      .toEqual(reopened.snapshot());
  });
});
