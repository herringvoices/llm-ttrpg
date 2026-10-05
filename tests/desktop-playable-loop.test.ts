import { describe, expect, it } from "vitest";
import {
  createGameRuntime,
  createInMemoryPersistence,
  campaignPlanDocumentSchema,
  fictionalDurationMs,
  loadGameDefinition,
  type PersistencePorts,
  type ModelRequest,
} from "@llm-ttrpg/engine";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
import { DesktopPlaySession } from "../apps/desktop/src/play-session.js";
import { createDesktopApplication } from "../apps/desktop/src/application.js";
import { contractTestGameDefinition } from "./support/contract-game.js";
import { createMigratedSqlitePersistence, createSqlJsClient } from "./support/sqlite.js";
import {
  generatedStart,
  startingRegionStageOutputs,
} from "../packages/reference-game/test/starting-region-fixture.js";

function generatedCampaignModel() {
  const outputs = startingRegionStageOutputs();
  const stageSteps = Object.entries(outputs).map(([stageId, value]) => ({
    id: `generate-${stageId}`,
    match: { schemaId: `starting-region.${stageId}.v1` },
    result: { kind: "structured" as const, value },
  }));
  return new ScriptedModelRuntime([
    ...stageSteps,
    {
      id: "audit-region",
      match: { schemaId: "starting-region.coherence-audit.v1" },
      result: { kind: "structured", value: { issues: [] } },
    },
    {
      id: "opening-incident",
      match: { schemaId: "awakening-earth.opening-incident-proposal" },
      result: (request: ModelRequest<unknown>) => {
        const rendered = JSON.parse(request.prompt.context!);
        const scene = rendered.situation.scene as Array<{
          localRef: string;
          displayIdentity: string;
        }>;
        const refForName = (name: string) => {
          const found = scene.find((item) => item.displayIdentity === name)?.localRef;
          if (!found) throw new Error(`Opening context omitted ${name}`);
          return found;
        };
        const player = outputs["player-context"].entity;
        const npc = outputs.npcs[0]!.entity;
        const creature = outputs.pressures.creatures[0]!;
        const location = outputs.locality.locations.find((item) =>
          item.id === "generated.location.grocery"
        )!;
        return {
          kind: "structured" as const,
          value: {
            incident: {
              id: "generated.incident.desktop-opening",
              name: "Desktop Opening Incident",
              summary: "A grounded supernatural threat emerges at the generated grocery.",
              locationRef: refForName(location.name),
              involvedRefs: [
                refForName(player.name),
                refForName(npc.name),
                refForName(creature.entity.name),
              ],
              groundingRefs: [refForName(location.name), refForName(creature.entity.name)],
              contactObject: {
                id: "generated.object.desktop-bat",
                name: "Loading Dock Bat",
                summary: "An ordinary wooden bat available at the loading dock.",
                wielderRef: refForName(player.name),
              },
              observedFacts: [{
                id: "generated.fact.desktop-frost",
                predicate: "incident.observable-condition",
                value: "blue frost spreads across the loading dock",
                visibility: "public",
                tags: ["incident", "frost"],
              }],
            },
            creature: {
              entityRef: refForName(creature.entity.name),
              deliberateNearTermPlayerFacing: true,
              threatEnvelope: creature.threatEnvelope,
              observedTraits: creature.observedTraits,
            },
            publicResponse: {
              institutionId: "generated.institution.desktop-response",
              institutionName: "Desktop Public Supernatural Response",
              responseId: "generated.response.desktop-opening",
              observedThreat: "A magical predator is active near the loading dock.",
              reportedAt: generatedStart,
              responsibleDispatch: "Municipal dispatch",
              responderAssignment: "Supernatural-response unit 2",
              dispatchDelayMs: 120_000,
              travelDurationMs: 480_000,
              onSceneDurationMs: 600_000,
              finalStatus: "contained",
            },
          },
        };
      },
    },
  ]);
}

function setup(persistence: PersistencePorts = createInMemoryPersistence()) {
  let id = 0;
  let tick = 0;
  const dependencies = {
    persistence,
    game: loadGameDefinition(contractTestGameDefinition),
    wallClock: { now: () => new Date(Date.UTC(2046, 0, 1, 0, 0, tick++)).toISOString() },
    idGenerator: {
      next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
        return `${kind}.desktop-${++id}`;
      },
    },
    worldSeedSource: { nextSeed: () => 0x1900_0019 },
  };
  return { dependencies, runtime: createGameRuntime(dependencies) };
}

function actionModel(narration: "success" | "fail" = "success") {
  return new ScriptedModelRuntime([
    {
      id: "route-action",
      match: { schemaId: "desktop.turn-route.v1" },
      result: { kind: "structured", value: { kind: "action" } },
    },
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
      result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } },
    },
    ...(narration === "success"
      ? [{
          id: "narrate",
          match: { operation: "player-action.narration.v1" },
          result: { kind: "text", text: "Amelia tests her footing and finds it holds." },
        } as const]
      : [{
          id: "narration-failure",
          match: { operation: "player-action.narration.v1" },
          result: { kind: "failure", failureKind: "runtime-unavailable", message: "Local model stopped" },
        } as const, {
          id: "narration-retry",
          match: { operation: "player-action.narration.v1" },
          result: { kind: "text", text: "The committed effort settles into place." },
        } as const]),
  ]);
}

describe("desktop playable session integration", () => {
  it("triggers a targeted low replan after a canonical action invalidates its assumption", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Planner integration");
    await engine.resolve({
      intent: {
        actorId: "campaign.entity.amelia",
        goal: "establish the initial position",
        targetIds: [],
        pressureLevel: 4,
        requestedHorizonMs: fictionalDurationMs(60_000),
        authorizedHorizonMs: fictionalDurationMs(60_000),
        wasNarrowed: false,
      },
      operation: {
        id: "test.resolution.resolve-contract-fixture",
        input: {
          actorId: "campaign.entity.amelia",
          mode: "automatic",
          modifier: 0,
          durationMs: 0,
          setStatus: "ready",
        },
      },
    });
    const basis = engine.planningBasis();
    const reviewed = { worldRevision: basis.worldRevision, eventSequence: basis.eventSequence };
    const initialPlan = campaignPlanDocumentSchema.parse({
      schemaVersion: 1,
      planRevision: 0,
      basedOnWorldRevision: basis.worldRevision,
      basedOnEventSequence: basis.eventSequence,
      updatedAtFictionalTime: engine.snapshot().fictionalTime,
      horizons: {
        high: { summary: "Keep broad options open.", attention: [], threadIds: [] },
        medium: { summary: "Follow the current situation.", attention: [], threadIds: [] },
        low: { summary: "Amelia is expected to remain nearby.", attention: ["Watch Amelia's next choice."], threadIds: ["thread.amelia-choice"] },
      },
      threads: [{
        id: "thread.amelia-choice",
        title: "Amelia's next choice",
        summary: "Attend to Amelia's immediate direction.",
        kind: "player-goal",
        horizon: "low",
        priority: 80,
        status: "active",
        grounding: [{ kind: "entity", id: "campaign.entity.amelia" }],
        related: [],
        playerInterestIds: [],
        currentTension: "Will Amelia remain or leave?",
        assumptions: [{
          id: "assumption.amelia-remains",
          summary: "Amelia remains ready nearby.",
          validation: {
            kind: "equals",
            reference: { kind: "entity", id: "campaign.entity.amelia", path: ["data", "status"] },
            expectedValue: "ready",
          },
          status: "valid",
          lastEvaluatedAt: reviewed,
        }],
        conditionalDevelopments: [],
        lastReviewedAt: reviewed,
        rationale: "Grounded in Amelia's current canonical status.",
      }],
      playerGoals: [],
      interestSignals: [],
    });
    await engine.initializeCampaignPlan(initialPlan);
    const model = new ScriptedModelRuntime([
      { id: "route", match: { schemaId: "desktop.turn-route.v1" }, result: { kind: "structured", value: { kind: "action" } } },
      { id: "intent", match: { schemaId: "player-action.intent-interpretation.v1" }, result: { kind: "structured", value: { kind: "interpreted", goal: "leave the expected situation", targetRefs: [], requestedHorizonMs: 60_000, pressureLevel: 6 } } },
      { id: "invoke", match: { schemaId: "player-action.execution-decision.v1" }, result: { kind: "structured", value: { kind: "invoke-tool", toolId: "test.resolution.resolve-contract-fixture", arguments: { mode: "automatic", modifier: 0, durationMs: 0, setStatus: "left-town" } } } },
      { id: "stop", match: { schemaId: "player-action.execution-decision.v1" }, result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } } },
      { id: "narrate", match: { operation: "player-action.narration.v1" }, result: { kind: "text", text: "Amelia leaves town, abandoning the expected opportunity." } },
      {
        id: "replan-low",
        match: { schemaId: "campaign-plan-mutation-proposal.v1" },
        result: (request: ModelRequest<unknown>) => {
          const context = JSON.parse(request.prompt.context!) as {
            plan: typeof initialPlan;
            authoritativeBasis: { worldRevision: number; eventSequence: number };
            signals: Array<{ id: string }>;
          };
          const current = context.plan.threads[0]!;
          return {
            kind: "structured" as const,
            value: {
              requestedHorizon: "low",
              basedOnPlanRevision: context.plan.planRevision,
              basedOnWorldRevision: context.authoritativeBasis.worldRevision,
              basedOnEventSequence: context.authoritativeBasis.eventSequence,
              consumedSignalIds: context.signals.map((signal) => signal.id),
              mutations: [{
                kind: "upsert-thread",
                thread: {
                  ...current,
                  priority: 95,
                  currentTension: "What follows from Amelia leaving town?",
                  assumptions: current.assumptions.map((assumption) => ({
                    ...assumption,
                    status: "invalid",
                    lastEvaluatedAt: context.authoritativeBasis,
                  })),
                  lastReviewedAt: context.authoritativeBasis,
                  rationale: "Adapt attention to the canonical departure without reversing it.",
                },
              }, {
                kind: "set-horizon",
                summary: "Follow consequences of Amelia's unexpected departure.",
                attention: ["Do not force Amelia back toward the abandoned hook."],
              }],
              rationale: "The near-term location assumption was invalidated.",
            },
          };
        },
      },
    ]);
    const play = new DesktopPlaySession(
      engine,
      model,
      "campaign.entity.amelia",
      undefined,
    );
    const beforeActionWorld = engine.snapshot();
    const result = await play.performTurn("I leave town instead.");
    expect(result.error).toBeUndefined();
    expect(result.diagnostics?.planner).toEqual(expect.objectContaining({
      horizonReviewed: "low",
      assumptionsInvalidated: ["assumption.amelia-remains"],
      canonicalMutationCount: 0,
    }));
    expect((await engine.campaignPlan())?.horizons.low.summary).toContain("unexpected departure");
    expect(engine.snapshot().entities.find((entity) =>
      entity.id === "campaign.entity.amelia"
    )?.data.status).toBe("left-town");
    expect(engine.snapshot()).not.toEqual(beforeActionWorld);
  });

  it("generates an Awakening Earth package, realizes the opening, and reconstructs it on reopen", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const model = generatedCampaignModel();
    const options = {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `generated-${++id}`,
      nextSeed: () => 0x1919_1919,
    };
    const app = createDesktopApplication(createSqlJsClient(database), options);
    const play = await app.createWorld({
      name: "Generated desktop campaign",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      playerDescription: "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
    });
    expect(play.view()).toEqual(expect.objectContaining({
      playerName: "Rowan",
      currentLocationName: expect.any(String),
    }));
    expect((await play.engineSession().eventHistory()).some((event) =>
      event.type === "campaign.opening-incident-realized"
    )).toBe(true);
    expect((await play.engineSession().campaignPlan())?.threads).toHaveLength(3);
    await play.save("Generated save");

    const reopened = await createDesktopApplication(
      createSqlJsClient(database),
      options,
    ).openWorld(play.view().worldId);
    expect(reopened.engineSession().snapshot()).toEqual(play.engineSession().snapshot());
    expect((await reopened.engineSession().campaignPlan())?.horizons.low.threadIds)
      .toEqual(["thread.near-term-choice"]);
    const beforeTime = Date.parse(reopened.view().fictionalTime);
    const afterCatchUp = await reopened.passThreeDaysAndCatchUp();
    expect(Date.parse(afterCatchUp.fictionalTime) - beforeTime)
      .toBe(3 * 24 * 60 * 60 * 1_000);
    expect(reopened.engineSession().snapshot().entities.find((entity) =>
      entity.id === "generated.response.desktop-opening"
    )?.data["response-state"]).toEqual(expect.objectContaining({
      status: "contained",
    }));
    expect((await reopened.engineSession().eventHistory()).some((event) =>
      event.type === "campaign.public-response-advanced"
    )).toBe(true);
  });

  it("returns setup follow-ups as a continuation step and reports generation progress", async () => {
    const { database } = await createMigratedSqlitePersistence();
    const outputs = startingRegionStageOutputs();
    const model = new ScriptedModelRuntime([{
      id: "normalize-with-follow-ups",
      match: { schemaId: "starting-region.normalize.v1" },
      result: {
        kind: "structured",
        value: {
          ...outputs.normalize,
          followUpQuestions: [{
            id: "question.town-name",
            question: "What is the town called?",
            materialImpact: "The name establishes the community's identity.",
          }],
          player: {
            ...outputs.normalize.player,
            followUpQuestions: [{
              id: "question.player-goal",
              question: "What does your character want right now?",
              materialImpact: "The answer shapes immediately relevant opportunities.",
            }],
          },
        },
      },
    }]);
    let id = 0;
    const options = {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `follow-up-${++id}`,
      nextSeed: () => 42,
    };
    const app = createDesktopApplication(createSqlJsClient(database), options);
    const progress: string[] = [];
    const result = await app.createCampaign({
      name: "Follow-up campaign",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      playerDescription: "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
      allowGeneratedDetails: false,
    }, {
      onProgress(update) {
        progress.push(`${update.current}/${update.total}:${update.stageId}`);
      },
    });

    expect(result).toEqual({
      kind: "needs-input",
      draftId: "draft.follow-up-2",
      questions: [
        expect.objectContaining({ id: "question.town-name", scope: "region" }),
        expect.objectContaining({ id: "question.player-goal", scope: "player" }),
      ],
    });
    expect(progress).toEqual(["1/12:normalize"]);
    const reopenedDrafts = await createDesktopApplication(
      createSqlJsClient(database),
      { modelRuntime: model },
    ).listCampaignDrafts();
    expect(reopenedDrafts).toEqual([
      expect.objectContaining({
        id: "draft.follow-up-2",
        status: "needs-input",
        lastCompletedStageId: "normalize",
        questions: expect.arrayContaining([
          expect.objectContaining({ id: "question.town-name" }),
        ]),
      }),
    ]);

    if (result.kind !== "needs-input") throw new Error("Expected setup questions");
    const restarted = createDesktopApplication(createSqlJsClient(database), {
      ...options,
      modelRuntime: generatedCampaignModel(),
    });
    const continued = await restarted.answerCampaignQuestions(
      result.draftId,
      result.questions.map((question) => ({
        ...question,
        answer: question.scope === "region" ? "The town is called Bellwether." : "Protect my sibling.",
      })),
      true,
    );
    expect(continued.kind).toBe("created");
    expect(await restarted.listCampaignDrafts()).toEqual([]);
  });

  it("resumes after a failed stage without regenerating accepted stages", async () => {
    const { database } = await createMigratedSqlitePersistence();
    const outputs = startingRegionStageOutputs();
    const failingModel = new ScriptedModelRuntime([
      {
        id: "normalize",
        match: { schemaId: "starting-region.normalize.v1" },
        result: { kind: "structured", value: outputs.normalize },
      },
      {
        id: "region",
        match: { schemaId: "starting-region.region.v1" },
        result: { kind: "structured", value: outputs.region },
      },
      {
        id: "settlement-failure",
        match: { schemaId: "starting-region.settlement.v1" },
        result: {
          kind: "failure",
          failureKind: "runtime-unavailable",
          message: "simulated local model stop",
        },
      },
    ]);
    let id = 0;
    const shared = {
      now: () => generatedStart,
      randomId: () => `resume-${++id}`,
      nextSeed: () => 77,
    };
    const firstApplication = createDesktopApplication(createSqlJsClient(database), {
      ...shared,
      modelRuntime: failingModel,
    });
    await expect(firstApplication.createCampaign({
      name: "Resumable campaign",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      playerDescription: "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
      allowGeneratedDetails: true,
    })).rejects.toThrow("simulated local model stop");

    const [draft] = await firstApplication.listCampaignDrafts();
    expect(draft).toEqual(expect.objectContaining({
      status: "failed",
      lastCompletedStageId: "region",
      errorMessage: expect.stringContaining("simulated local model stop"),
    }));

    const resumedModel = generatedCampaignModel();
    const reopenedApplication = createDesktopApplication(createSqlJsClient(database), {
      ...shared,
      modelRuntime: resumedModel,
    });
    const result = await reopenedApplication.resumeCampaign(draft!.id);
    expect(result.kind).toBe("created");
    expect(resumedModel.invocations.map((invocation) => invocation.schemaId))
      .not.toContain("starting-region.normalize.v1");
    expect(resumedModel.invocations.map((invocation) => invocation.schemaId))
      .not.toContain("starting-region.region.v1");
    expect(await reopenedApplication.listCampaignDrafts()).toEqual([]);
  });

  it("creates, saves, closes, and reopens through the actual desktop application boundary", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const options = {
      now: () => "2046-01-01T00:00:00.000Z",
      randomId: () => `desktop-smoke-${++id}`,
      nextSeed: () => 12345,
    };
    const firstApplication = createDesktopApplication(createSqlJsClient(database), options);
    const first = await firstApplication.createWorld("Desktop lifecycle");
    first.setNarrationPreference("expansive");
    await first.save("Manual save");
    const state = first.engineSession().snapshot();
    const worldId = first.view().worldId;

    const reopenedApplication = createDesktopApplication(createSqlJsClient(database), options);
    const reopened = await reopenedApplication.openWorld(worldId);
    expect(reopened.view().narrationPreference).toBe("expansive");
    expect(reopened.engineSession().snapshot()).toEqual(state);
    expect(await reopened.engineSession().listSlots()).toEqual([
      expect.objectContaining({ name: "Manual save" }),
    ]);

    await expect(reopenedApplication.openWorld("world.missing"))
      .rejects.toThrow("metadata is missing");
    expect(await reopenedApplication.listWorlds()).toHaveLength(1);
  });

  it("runs a freeform turn through production orchestration and exposes bounded diagnostics", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Desktop smoke");
    const savedPresentation: unknown[] = [];
    const play = new DesktopPlaySession(
      engine,
      actionModel(),
      "campaign.entity.amelia",
      undefined,
      {},
      { savePresentation: async (value) => { savedPresentation.push(value); } },
    );

    const before = engine.snapshot();
    const view = await play.performTurn("I test my footing and press forward.");
    expect(view.error).toBeUndefined();
    expect(view.transcript).toEqual([
      expect.objectContaining({ speaker: "player", text: "I test my footing and press forward." }),
      expect.objectContaining({ speaker: "narrator", text: expect.stringContaining("footing") }),
    ]);
    expect(view.diagnostics).toEqual(expect.objectContaining({
      route: "action",
      worldRevisionBefore: 0,
      worldRevisionAfter: 2,
      narrationStatus: "complete",
      eventCountAfter: expect.any(Number),
      growth: expect.objectContaining({ entities: before.entities.length }),
    }));
    expect(JSON.stringify(await engine.eventHistory())).not.toContain("Authorized context");

    play.setNarrationPreference("concise");
    await play.save("Manual save");
    expect(savedPresentation).toEqual([
      expect.objectContaining({ narrationPreference: "concise" }),
    ]);
  });

  it("keeps unavailable-model errors recoverable and leaves canon unchanged", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("No model");
    const before = engine.snapshot();
    const history = await engine.eventHistory();
    const play = new DesktopPlaySession(
      engine,
      undefined,
      "campaign.entity.amelia",
      undefined,
    );
    const view = await play.performTurn("I look around.");
    expect(view.error).toContain("No local model runtime");
    expect(engine.snapshot()).toEqual(before);
    expect(await engine.eventHistory()).toEqual(history);
  });

  it("retries failed post-commit narration without replaying the action", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Narration recovery");
    const firstModel = actionModel("fail");
    const play = new DesktopPlaySession(
      engine,
      firstModel,
      "campaign.entity.amelia",
      undefined,
    );
    const failed = await play.performTurn("I test my footing.");
    expect(failed.diagnostics?.narrationStatus).toBe("failed");
    const basisAfterCommit = engine.planningBasis();
    const historyAfterCommit = await engine.eventHistory();

    const retried = await play.retryNarration();
    expect(retried.transcript.at(-1)?.text).toContain("committed effort");
    expect(engine.planningBasis()).toEqual(basisAfterCommit);
    expect(await engine.eventHistory()).toEqual(historyAfterCommit);
  });
});
