import { describe, expect, it } from "vitest";
import {
  createHarness,
  defineScenario,
  fantasyHarnessScenario,
  scriptedModel,
} from "@llm-ttrpg/harness";
import { contractTestGameDefinition } from "./support/contract-game.js";
import {
  referenceConversationBindings,
  referenceGameDefinition,
  referenceSceneSource,
} from "@llm-ttrpg/reference-game";
import {
  WEEK_MS,
  simulationTestGameDefinition,
} from "./support/simulation-game.js";

const townScenario = defineScenario({
  id: "harness.fixture-town",
  description: "Existing lazy-simulation fixture composed through the harness.",
  game: simulationTestGameDefinition(),
  seed: 0x1234_5678,
});

function actionModel() {
  return scriptedModel([
    {
      id: "interpret",
      match: { schemaId: "player-action.intent-interpretation.v1" },
      result: {
        kind: "structured",
        value: {
          kind: "interpreted",
          goal: "test the current position",
          targetRefs: [],
          requestedHorizonMs: 60_000,
          pressureLevel: 6,
        },
      },
    },
    {
      id: "discover-subsystems",
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: { kind: "discover-subsystems", domainId: "test" },
      },
    },
    {
      id: "discover-tools",
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: {
          kind: "discover-tools",
          domainId: "test",
          subsystemId: "actions",
        },
      },
    },
    {
      id: "inspect-tool",
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: { kind: "inspect-tool", toolId: "test.actions.resolve-effort" },
      },
    },
    {
      id: "invoke",
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: {
          kind: "invoke-tool",
          toolId: "test.actions.resolve-effort",
          arguments: { base: 8, modifier: 2, difficulty: 9, durationMs: 1_000 },
        },
      },
    },
    {
      id: "stop",
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: { kind: "stop", reason: "goal-achieved" },
      },
    },
    {
      id: "narrate",
      match: { outputKind: "text", operation: "player-action.narration.v1" },
      result: { kind: "text", text: "Amelia tests her footing and it holds." },
    },
    {
      id: "invalid-interpretation",
      match: { schemaId: "player-action.intent-interpretation.v1" },
      result: { kind: "schema-invalid", value: { wrong: true } },
      repeat: true,
    },
  ]);
}

const actionScenario = defineScenario({
  id: "harness.fixture-action",
  description: "Production player-action orchestration with a scripted model.",
  game: contractTestGameDefinition,
  seed: 0x1234_5678,
  modelRuntimeFactory: actionModel,
  sceneSource: referenceSceneSource,
});

const conversationScenario = defineScenario({
  id: "harness.fixture-conversation",
  description: "Production conversation orchestration through the harness.",
  game: referenceGameDefinition,
  seed: 0x1234_5678,
  sceneSource: referenceSceneSource,
  modelRuntimeFactory: () => scriptedModel([
    {
      id: "interpret-conversation",
      match: { schemaId: "conversation.player-communication.v1" },
      result: {
        kind: "structured",
        value: {
          inputMode: "described",
          exactQuoteFragments: [],
          semanticKinds: ["question"],
          authorizedContent: "ask Nina about her shift",
          testimonyIds: [],
          materialCommitments: [],
          deliveryIntent: "honest",
          containsNonSpeechAction: false,
          estimatedDurationMs: 1_000,
          pressureLevel: 3,
        },
      },
    },
    {
      id: "nina-decision",
      match: { schemaId: "conversation.npc-decision.v1" },
      result: (request) => {
        const input = JSON.parse(request.prompt.input) as { actorRef: string };
        return {
          kind: "structured",
          value: {
            actorId: input.actorRef,
            interpretation: "Amelia asked an ordinary question about work.",
            responseKind: "speak",
            intendedSpeechSemantics: "Nina says the shift has been tense.",
            speechSemanticKinds: ["assertion"],
            estimatedSpeechDurationMs: 500,
            disclosure: { mode: "none" },
            sceneState: {
              actorId: input.actorRef,
              interpretation: "Amelia is asking about the shift.",
              attention: ["Amelia", "the current shift"],
              immediatePriorities: ["answer briefly"],
              stance: "cautious",
              wants: ["keep working"],
              reluctantToRevealIds: [],
              considering: ["whether to mention the manager"],
              unresolvedQuestions: ["why Amelia is asking"],
            },
            requiresAuthoritativeResolution: false,
            stopReason: "answer-expected",
          },
        };
      },
    },
    {
      id: "narrate-conversation",
      match: { outputKind: "text", operation: "conversation.narration.v1" },
      result: {
        kind: "text",
        text: "Amelia asks about the shift. Nina admits that it has been tense.",
      },
    },
  ]),
});

describe("simulation and test harness", () => {
  it("separates time from catch-up and deterministically reproduces the town", async () => {
    const harness = createHarness({
      scenarios: [townScenario],
      traceLevel: "full",
    });
    const session = await harness.loadScenario(townScenario.id);
    const initial = await session.snapshot();
    const start = initial.state.fictionalTime;

    await session.advanceTime(3 * WEEK_MS);
    expect(session.world().simulationCursors.every((cursor) =>
      cursor.lastSimulatedAt === start
    )).toBe(true);
    const injected = await session.injectEvent({
      type: "test.route-disrupted",
      schemaVersion: 1,
      summary: "Harness-injected route disruption.",
      scopeIds: ["scope.test-town"],
      payload: { scopeId: "scope.test-town" },
    });
    expect(injected.origin).toEqual({
      kind: "harness-injection",
      id: townScenario.id,
    });
    const caughtUp = await session.catchUp({ scopeId: "scope.test-town" });
    expect(caughtUp.kind).toBe("caught-up");
    if (caughtUp.kind !== "caught-up") throw new Error("Expected catch-up");
    expect(caughtUp.awakenedScopeIds).not.toContain("scope.unrelated-town");
    expect(caughtUp.randomness).toEqual([
      expect.objectContaining({ stream: 0, draws: 1 }),
    ]);
    const final = await session.snapshot();
    const diff = session.diff(initial, final);
    expect(diff.changedCategories).toEqual(expect.arrayContaining([
      "time",
      "revision",
      "entities",
      "events",
      "simulation-cursors",
      "rng",
    ]));
    expect([...diff.changes]).toEqual([...diff.changes].sort((left, right) =>
      left.category.localeCompare(right.category) || left.path.localeCompare(right.path)
    ));
    expect(session.trace("summary").every((entry) => !entry.decision && !entry.full))
      .toBe(true);
    expect(session.trace("decision").some((entry) => entry.decision)).toBe(true);
    expect(session.trace("full").some((entry) => entry.full)).toBe(true);
    expect(session.rngInspection()).toEqual(expect.objectContaining({
      state: expect.objectContaining({ rootSeed: townScenario.seed, nextStream: 1 }),
    }));

    const firstAuthoritative = {
      state: final.state,
      history: final.history,
      eventSequence: final.eventSequence,
    };
    await session.reset();
    await session.advanceTime(3 * WEEK_MS);
    await session.injectEvent({
      type: "test.route-disrupted",
      schemaVersion: 1,
      summary: "Harness-injected route disruption.",
      scopeIds: ["scope.test-town"],
      payload: { scopeId: "scope.test-town" },
    });
    await session.catchUp({ scopeId: "scope.test-town" });
    const repeated = await session.snapshot();
    expect({
      state: repeated.state,
      history: repeated.history,
      eventSequence: repeated.eventSequence,
    }).toEqual(firstAuthoritative);
  });

  it("inspects perspective context/tools and traces scripted success and failure atomically", async () => {
    const harness = createHarness({ scenarios: [actionScenario], traceLevel: "full" });
    const session = await harness.loadScenario(actionScenario.id);
    const nina = session.inspectContext({
      role: "actor",
      perspective: { kind: "actor", id: "campaign.entity.nina" },
      focalActorId: "campaign.entity.nina",
      locationId: "campaign.location.brownbag-groceries",
      budget: { maxUnits: 50_000 },
    });
    const amelia = session.inspectContext({
      role: "actor",
      perspective: { kind: "actor", id: "campaign.entity.amelia" },
      focalActorId: "campaign.entity.amelia",
      locationId: "campaign.location.brownbag-groceries",
      budget: { maxUnits: 50_000 },
    });
    expect(nina.package.situation.scene.length).toBeGreaterThan(0);
    expect(amelia.package.situation.scene.length).toBeGreaterThan(0);
    const ninaKnowledge = await session.inspectQuery(
      "knowledge.facts.retrieve",
      {},
      {
        role: "actor",
        perspective: { kind: "actor", id: "campaign.entity.nina" },
        focalActorId: "campaign.entity.nina",
      },
    );
    const ameliaKnowledge = await session.inspectQuery(
      "knowledge.facts.retrieve",
      {},
      {
        role: "actor",
        perspective: { kind: "actor", id: "campaign.entity.amelia" },
        focalActorId: "campaign.entity.amelia",
      },
    );
    expect(JSON.stringify(ninaKnowledge)).toContain("salt to ward off");
    expect(JSON.stringify(ameliaKnowledge)).not.toContain("salt to ward off");
    const tools = session.inspectTools();
    expect(JSON.stringify(tools)).toContain("test.actions.resolve-effort");
    expect(JSON.stringify(tools)).not.toContain("unsafePatchWorldForTest");

    const result = await session.executeAction({
      actionId: "action.harness-success",
      actorId: "campaign.entity.amelia",
      declaration: "I test my footing.",
      budget: { maxUnits: 50_000 },
    });
    expect(result.kind).toBe("resolved");
    const beforeFailure = await session.snapshot();
    const failed = await session.executeAction({
      actionId: "action.harness-invalid",
      actorId: "campaign.entity.amelia",
      declaration: "I attempt an invalid scripted action.",
      budget: { maxUnits: 50_000 },
    });
    expect(failed.kind).toBe("failed");
    const afterFailure = await session.snapshot();
    expect(afterFailure.state).toEqual(beforeFailure.state);
    expect(afterFailure.history).toEqual(beforeFailure.history);
    expect(session.trace("full").some((entry) =>
      JSON.stringify(entry.full).includes("invalid-interpretation")
    )).toBe(true);
  });

  it("isolates forks, runs probes, and replays a deterministic reproduction", async () => {
    const harness = createHarness({ scenarios: [actionScenario] });
    const source = await harness.loadScenario(actionScenario.id);
    await source.executeOperation("test.actions.resolve-effort", {
      actorId: "campaign.entity.amelia",
      base: 7,
      modifier: 1,
      difficulty: 7,
      durationMs: 100,
    });
    const sourceBefore = await source.snapshot();
    const branch = await source.fork("alternate-effort");
    await branch.executeOperation("test.actions.resolve-effort", {
      actorId: "campaign.entity.amelia",
      base: 10,
      modifier: 2,
      difficulty: 8,
      durationMs: 500,
    });
    expect((await source.snapshot()).state).toEqual(sourceBefore.state);
    expect((await branch.snapshot()).state.fictionalTime)
      .not.toBe(sourceBefore.state.fictionalTime);

    const bundle = await branch.exportReproduction("fixture branch");
    const replay = await harness.loadScenario(actionScenario.id);
    const replayed = await replay.replayReproduction(bundle);
    const branchFinal = await branch.snapshot();
    expect(replayed.state.fictionalTime).toBe(branchFinal.state.fictionalTime);
    expect(replayed.eventSequence).toBe(branchFinal.eventSequence);
    expect(replayed.state.randomness).toEqual(branchFinal.state.randomness);

    const probes = await source.runChallengeProbes([
      {
        id: "careful",
        run: (fork) => fork.executeOperation("test.actions.resolve-effort", {
          actorId: "campaign.entity.amelia",
          base: 8,
          modifier: 3,
          difficulty: 9,
          durationMs: 250,
        }),
      },
      {
        id: "reckless",
        run: (fork) => fork.executeOperation("test.actions.resolve-effort", {
          actorId: "campaign.entity.amelia",
          base: 4,
          modifier: 0,
          difficulty: 9,
          durationMs: 250,
        }),
      },
    ]);
    expect(probes.map((probe) => probe.id)).toEqual(["careful", "reckless"]);
    expect(probes.every((probe) => probe.diff.changedCategories.includes("events")))
      .toBe(true);
    expect((await source.snapshot()).state).toEqual(sourceBefore.state);
  });

  it("executes conversation through the production #14 orchestration seam", async () => {
    const harness = createHarness({ scenarios: [conversationScenario] });
    const session = await harness.loadScenario(conversationScenario.id);
    const result = await session.executeConversation({
      turnId: "turn.harness-conversation",
      interactionId: "interaction.harness-conversation",
      playerActorId: "campaign.entity.amelia",
      playerCharacterName: "Amelia",
      recipientIds: ["campaign.entity.nina"],
      materialNpcIds: [],
      declaration: "I ask Nina how her shift has been.",
      locationId: "campaign.location.brownbag-groceries",
      narrationPreference: "standard",
      beatComplexity: "ordinary",
      budget: { maxUnits: 50_000 },
      authorizedMaterialSemanticKinds: [],
      authorizedMaterialCommitments: [],
      authorizedDeception: false,
      authorizedTestimony: [],
      extractDurableConsequences: false,
    }, referenceConversationBindings);
    expect(result.communicationCommitted).toBe(true);
    expect(result.decisions[0]?.actorId).toBe("campaign.entity.nina");
    // The legacy orchestration can still run without making ordinary speech canonical.
    expect((await session.eventHistory()).filter((event) =>
      event.type === "rules.communication-recorded"
    )).toHaveLength(0);
    const bundle = await session.exportReproduction();
    expect(bundle.commands.some((command) =>
      command.kind === "execute-conversation"
    )).toBe(true);
    expect(bundle.scriptedModelInvocations?.map((item) =>
      (item as { matchedStepId?: string }).matchedStepId
    )).toEqual([
      "interpret-conversation",
      "nina-decision",
      "narrate-conversation",
    ]);
  });

  it("runs the package-neutral fantasy fixture without Awakening Earth branches", async () => {
    const harness = createHarness({ scenarios: [fantasyHarnessScenario] });
    const session = await harness.loadScenario(fantasyHarnessScenario.id);
    const before = await session.snapshot();
    expect(JSON.stringify(session.game().composition)).not.toContain("awakening");
    expect(JSON.stringify(session.inspectTools())).toContain("fantasy.actions.cast-spark");
    const context = session.inspectContext({
      role: "actor",
      perspective: { kind: "actor", id: "fantasy.entity.wizard" },
      focalActorId: "fantasy.entity.wizard",
      locationId: "fantasy.location.town",
      budget: { maxUnits: 20_000 },
    });
    expect(JSON.stringify(context.package)).toContain("Mira");
    await session.executeOperation("fantasy.actions.cast-spark", {
      actorId: "fantasy.entity.wizard",
      targetId: "fantasy.entity.goblin",
      durationMs: 500,
    });
    await session.advanceTime(2 * 86_400_000);
    expect(session.world().simulationCursors[0]?.lastSimulatedAt)
      .toBe(before.state.fictionalTime);
    await session.catchUp({ scopeId: "fantasy.scope.town" });
    expect(session.world().entities.find((entity) =>
      entity.id === "fantasy.entity.goblin"
    )?.data).toEqual(expect.objectContaining({
      startled: true,
      restlessness: 2,
    }));
    const diff = session.diff(before, await session.snapshot());
    expect(diff.changedCategories).toEqual(expect.arrayContaining([
      "entities",
      "events",
      "simulation-cursors",
      "time",
    ]));

    await session.unsafePatchWorldForTest((draft) => {
      draft.entities.push({ ...draft.entities[0]! });
    }, "duplicate an entity to exercise corrupt-state diagnostics");
    const corrupted = await session.inspectPersistedWorld();
    expect(corrupted.state.entities.filter((entity) =>
      entity.id === corrupted.state.entities[0]?.id
    )).toHaveLength(2);
    expect(JSON.stringify(session.inspectTools())).not.toContain(
      "unsafePatchWorldForTest",
    );
    await session.reset();
    expect(new Set(session.world().entities.map((entity) => entity.id)).size)
      .toBe(session.world().entities.length);
  });
});
