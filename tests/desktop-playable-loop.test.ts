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
import { ScriptedModelRuntime, type ScriptedModelStep } from "@llm-ttrpg/harness";
import { DesktopPlaySession } from "../apps/desktop/src/play-session.js";
import { createDesktopApplication } from "../apps/desktop/src/application.js";
import { contractTestGameDefinition } from "./support/contract-game.js";
import { createMigratedSqlitePersistence, createSqlJsClient } from "./support/sqlite.js";
import {
  generatedStart,
  startingRegionStageOutputs,
} from "../packages/reference-game/test/starting-region-fixture.js";
import { quickChangePower } from "@llm-ttrpg/reference-game";

function generatedCampaignModel(options: {
  readonly minimalPlayer?: boolean;
  readonly playerName?: string;
  readonly openingSituation?: Readonly<Record<string, unknown>>;
  readonly turnSteps?: readonly ScriptedModelStep[];
} = {}) {
  const outputs = startingRegionStageOutputs();
  const stageSteps = Object.entries(outputs).map(([stageId, value]) => ({
    id: `generate-${stageId}`,
    match: { schemaId: `starting-region.${stageId}.v1` },
    result: {
      kind: "structured" as const,
      value: stageId === "opening-situation" && options.openingSituation
        ? { ...outputs["opening-situation"], ...options.openingSituation }
        : stageId === "normalize" && options.minimalPlayer
        ? {
            ...outputs.normalize,
            player: {
              establishedFacts: [],
              unspecifiedAreas: ["sex/gender", "appearance", "hobbies", "biography"],
              currentWants: [],
              powerPreferences: { positive: [], negative: [], surpriseMe: true },
              followUpQuestions: [],
            },
          }
        : stageId === "player-context"
        ? (() => {
            const player = outputs["player-context"];
            return {
              entity: {
                id: player.entity.id,
                name: player.entity.name,
                summary: player.entity.summary,
              },
              homeLocationId: player.homeLocationId,
              routineLocationIds: player.routineLocationIds,
              accessEntityIds: player.accessEntityIds,
              currentObligations: player.currentObligations,
              ordinaryPressures: player.ordinaryPressures,
              mechanicalSignals: {
                attributeDirections: player.mechanics.attributeEvidence.filter((item) =>
                  item.direction !== "near-baseline"
                ),
                skills: player.mechanics.mechanics.skills.map((skill) => {
                  const evidence = player.mechanics.skillEvidence.find((item) =>
                    item.skillId === skill.id
                  )!;
                  return {
                    skill,
                    rationale: evidence.rationale,
                    sourceFactIds: evidence.sourceFactIds,
                  };
                }),
              },
              provenance: player.provenance,
            };
          })()
        : stageId === "npcs"
          ? outputs.npcs.map((npc) => {
              const relationship = npc.socialState.relationships.find((item) =>
                item.targetEntityId === outputs["player-context"].entity.id
              );
              return {
                name: npc.entity.name,
                summary: npc.entity.summary,
                simulationReasons: npc.simulationReasons,
                goals: npc.socialState.goals.map((goal) => goal.description),
                ...(relationship
                  ? {
                      relationshipToPlayer: {
                        dimensions: relationship.dimensions,
                        salience: relationship.salience,
                        tags: relationship.tags,
                      },
                    }
                  : {}),
                memories: npc.socialState.memories.map((memory) => ({
                  summary: memory.summary,
                  salience: memory.salience,
                  tags: memory.tags,
                })),
                mechanicallyRelevantConstraints: npc.mechanicallyRelevantConstraints.map(
                  (constraint) => ({ summary: constraint.summary }),
                ),
                ...("awakenedLicenseBand" in npc
                  ? { awakenedLicenseBand: npc.awakenedLicenseBand }
                  : {}),
              };
            })
        : stageId === "pressures"
          ? {
              pressures: outputs.pressures.pressures.map((pressure) => ({
                category: pressure.category,
                summary: pressure.summary,
                currentState: pressure.currentState,
                cause: pressure.cause,
                likelyTrajectory: pressure.likelyTrajectory,
                actorEntityIds: pressure.actorEntityIds,
                scope: pressure.scopeId.includes(".region.")
                  ? "region"
                  : pressure.scopeId.includes(".settlement.")
                    ? "settlement"
                    : "locality",
                changeConditions: pressure.changeConditions,
                visibility: pressure.category === "supernatural" ? "hidden" : "public",
              })),
              creatures: outputs.pressures.creatures.map((creature) => ({
                name: creature.entity.name,
                summary: creature.entity.summary,
                origin: creature.origin,
                morphology: creature.morphology,
                behavior: creature.behavior,
                corePrinciple: creature.corePrinciple,
                observedTraits: creature.observedTraits,
                nearTermPlayerFacing: creature.nearTermPlayerFacing,
                threat: {
                  challengeBand: creature.threatEnvelope?.challengeBand,
                  overallThreat: creature.threatEnvelope?.overallThreat,
                  hardCounterRisks: creature.threatEnvelope?.hardCounterRisks ?? [],
                  signatureCapabilities:
                    creature.threatEnvelope?.requiredSignatureCapabilities ?? [],
                  tells: creature.threatEnvelope?.requiredTells ?? [],
                  counterplay: creature.threatEnvelope?.requiredCounterplay ?? [],
                },
              })),
              beliefs: outputs.pressures.knowledge.beliefs.map((belief) => ({
                holderActorId: belief.holder.id,
                subjectRef: outputs.pressures.creatures.find((creature) =>
                  creature.entity.id === belief.subjectId
                )?.entity.name ?? belief.subjectId,
                proposition: belief.proposition,
                truthStatus: belief.truthStatus,
                confidence: belief.confidence,
              })),
            }
        : value,
    },
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
      match: { schemaId: "awakening-earth.opening-incident-compact-v1" },
      result: (request: ModelRequest<unknown>) => {
        const rendered = JSON.parse(request.prompt.context!);
        const scene = rendered.scene as Array<{
          localRef: string;
          displayIdentity: string;
        }>;
        const refForName = (name: string) => {
          const found = scene.find((item) => item.displayIdentity === name)?.localRef;
          if (!found) throw new Error(`Opening context omitted ${name}`);
          return found;
        };
        const player = outputs["player-context"].entity;
        const playerName = options.playerName ?? player.name;
        const npc = outputs.npcs[0]!.entity;
        const creature = outputs.pressures.creatures[0]!;
        const location = outputs.locality.locations.find((item) =>
          item.id === "generated.location.grocery"
        )!;
        return {
          kind: "structured" as const,
          value: {
            incident: {
              name: "Desktop Opening Incident",
              summary: "A grounded supernatural threat emerges at the generated grocery.",
              locationRef: refForName(location.name),
              involvedRefs: [
                refForName(playerName),
                refForName(npc.name),
                refForName(creature.entity.name),
              ],
              groundingRefs: [refForName(location.name), refForName(creature.entity.name)],
              contactObject: {
                name: "Loading Dock Bat",
                summary: "An ordinary wooden bat available at the loading dock.",
                wielderRef: refForName(playerName),
              },
              observedCondition: "blue frost spreads across the loading dock",
            },
            creature: {
              entityRef: refForName(creature.entity.name),
              observedTraits: creature.observedTraits,
            },
            publicResponse: {
              institutionName: "Desktop Public Supernatural Response",
              observedThreat: "A magical predator is active near the loading dock.",
              responsibleDispatch: "Municipal dispatch",
              responderAssignment: "Supernatural-response unit 2",
              finalStatus: "contained",
            },
          },
        };
      },
    },
    {
      id: "opening-narration",
      match: {
        operation: "desktop.opening-narration.v1",
        outputKind: "text",
        predicate: (request) =>
          request.prompt.protectedContext?.join("\n").includes("awakening-earth-grounded") === true &&
          request.prompt.protectedContext?.join("\n").includes('"kind":"opening"') === true,
      },
      result: (request: ModelRequest<unknown>) => {
        const input = JSON.parse(request.prompt.input) as {
          mode?: string;
          phenomenon?: { summary?: string };
        };
        if (input.mode === "mundane-manifestation") {
          return {
            kind: "text" as const,
            text: "The grocery store settles into its ordinary afternoon rhythm: scanner beeps, cart wheels chatter, and Alice is sorting a delivery beside you.",
          };
        }
        if (input.phenomenon) {
          return {
            kind: "text" as const,
            text: `Something impossible interrupts the familiar loading dock: ${input.phenomenon.summary ?? "a supernatural anomaly is unfolding"}.`,
          };
        }
        return {
          kind: "text" as const,
          text: "Blue frost crawls over the loading dock as a strange feline silhouette watches from between the pallets. The bat beside your hand is ordinary wood, but it is the nearest solid thing between you and the creature.",
        };
      },
    },
    ...(options.turnSteps ?? []),
  ]);
}


function openingActionSteps(
  prefix: string,
  options: {
    readonly includePowerManifestation?: boolean;
    readonly failFirstPowerProposalOnce?: boolean;
    readonly failFirstPowerNarrationOnce?: boolean;
  } = {},
): ScriptedModelStep[] {
  const steps: ScriptedModelStep[] = [
    {
      id: `${prefix}-interpret-action`,
      match: { schemaId: "turn.declaration.v1" },
      result: {
        kind: "structured",
        value: { kind: "interpreted", segments: [{
          kind: "action",
          goal: "continue a harmless ordinary action",
          targetRefs: [],
          modes: ["manipulation"],
          statedMeans: [],
          requestedHorizonMs: 30_000,
          pressureLevel: 2,
        }] },
      },
    },
    {
      id: `${prefix}-invoke-action`,
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: {
          kind: "invoke-tool",
          toolId: "rules.actions.complete-routine-task",
          arguments: {
            actorId: "scene.001",
            actionSummary: "Continue the stated ordinary task.",
            durationMs: 1_000,
          },
        },
      },
    },
    {
      id: `${prefix}-action-arguments`,
      match: { schemaId: "player-action.tool-arguments.v1" },
      result: {
        kind: "structured",
        value: {
          actionSummary: "Continue the stated ordinary task.",
          durationMs: 1_000,
        },
      },
    },
    {
      id: `${prefix}-stop-action`,
      match: { schemaId: "player-action.execution-decision.v1" },
      result: {
        kind: "structured",
        value: { kind: "stop", reason: "goal-achieved" },
      },
    },
    {
      id: `${prefix}-narrate-action`,
      match: { operation: "player-action.narration.v1" },
      result: {
        kind: "text",
        text: "You continue the ordinary task without anything else demanding a decision yet.",
      },
    },
  ];

  if (options.includePowerManifestation) {
    if (options.failFirstPowerProposalOnce) {
      steps.push({
        id: `${prefix}-power-proposal-failure`,
        match: { schemaId: "awakening-earth.power-proposal.v1" },
        result: {
          kind: "failure",
          failureKind: "timeout",
          message: "simulated power generation timeout",
        },
      });
    }
    steps.push({
      id: `${prefix}-power-proposal`,
      match: { schemaId: "awakening-earth.power-proposal.v1" },
      result: {
        kind: "structured",
        value: {
          power: quickChangePower,
          preferenceRationale:
            "Quick Change is a coherent physical utility power that fits an otherwise ordinary character and violates no negative preference.",
          negativeConstraintsRespected: true,
        },
      },
    });
    if (options.failFirstPowerNarrationOnce) {
      steps.push({
        id: `${prefix}-power-narration-failure`,
        match: { operation: "desktop.first-power-narration.v1" },
        result: {
          kind: "failure",
          failureKind: "runtime-unavailable",
          message: "simulated presentation failure",
        },
      });
    }
    steps.push({
      id: `${prefix}-power-narration`,
      match: { operation: "desktop.first-power-narration.v1" },
      result: {
        kind: "text",
        text: "For one impossible instant, your sense of your own weight becomes something you can change deliberately.",
      },
    });
  }
  return steps;
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
      id: "interpret",
      match: { schemaId: "turn.declaration.v1" },
      result: {
        kind: "structured",
        value: { kind: "interpreted", segments: [{
          kind: "action",
          goal: "test the current position",
          targetRefs: [],
          modes: ["manipulation"],
          statedMeans: [],
          requestedHorizonMs: 60_000,
          pressureLevel: 6,
        }] },
      },
    },
    {
      id: "arguments",
      match: { schemaId: "player-action.tool-arguments.v1" },
      result: { kind: "structured", value: {
        base: 8, modifier: 2, difficulty: 9, durationMs: 1_000,
      } },
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
  it("bounds a long creative search to pressure 9 through a registered general handler", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Pressure-bound creative action");
    const beforeTime = Date.parse(engine.snapshot().fictionalTime);
    const model = new ScriptedModelRuntime([
      { id: "classify", match: { schemaId: "turn.declaration.v1" },
        result: { kind: "structured", value: { kind: "interpreted", segments: [{
          kind: "action", goal: "search for Jonny throughout the morning",
          modes: ["other"], targetRefs: [], statedMeans: ["search"],
          pressureLevel: 9, requestedHorizonMs: 28800000,
        }] } } },
      { id: "arguments", match: { schemaId: "player-action.tool-arguments.v1" },
        result: { kind: "structured", value: {
          mode: "automatic", modifier: 0, durationMs: 28800000,
        } } },
      { id: "stop", match: { schemaId: "player-action.execution-decision.v1" },
        result: { kind: "structured", value: { kind: "stop", reason: "budget-exhausted" } } },
      { id: "narrate", match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "You make only a brief start before the urgency interrupts you." } },
    ]);
    const play = new DesktopPlaySession(engine, model, "campaign.entity.amelia", undefined);
    const view = await play.performTurn("I search for Jonny all morning.");
    expect(view.error).toBeUndefined();
    expect(Date.parse(engine.snapshot().fictionalTime) - beforeTime).toBe(5_000);
    const events = await engine.eventHistory({ types: ["test.contract-resolution-recorded"] });
    expect(events).toHaveLength(1);
    const schemas = model.invocations.map((invocation) => invocation.schemaId);
    expect(schemas.filter((id) => id === "turn.declaration.v1")).toHaveLength(1);
    expect(schemas).not.toContain("desktop.turn-route.v1");
    expect(schemas).not.toContain("player-action.intent-interpretation.v1");
  });

  it("executes two ordered action segments with distinct replay-safe action identities", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Segmented turn");
    const declaration = "I test my footing, then I knock twice.";
    const model = new ScriptedModelRuntime([
      { id: "classify", match: { schemaId: "turn.declaration.v1" },
        result: { kind: "structured", value: { kind: "interpreted", segments: [
          { kind: "action", text: "I test my footing", goal: "test footing",
            modes: ["manipulation"], targetRefs: [], statedMeans: [],
            pressureLevel: 6, requestedHorizonMs: 60000 },
          { kind: "action", text: "I knock twice", goal: "knock twice",
            modes: ["manipulation"], targetRefs: [], statedMeans: ["knock"],
            pressureLevel: 6, requestedHorizonMs: 60000 },
        ] } } },
      { id: "args-1", match: { schemaId: "player-action.tool-arguments.v1" },
        result: { kind: "structured", value: { base: 8, modifier: 1, difficulty: 7, durationMs: 1000 } } },
      { id: "stop-1", match: { schemaId: "player-action.execution-decision.v1" },
        result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } } },
      { id: "narrate-1", match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "Your footing holds." } },
      { id: "args-2", match: { schemaId: "player-action.tool-arguments.v1" },
        result: { kind: "structured", value: { base: 8, modifier: 1, difficulty: 7, durationMs: 1000 } } },
      { id: "stop-2", match: { schemaId: "player-action.execution-decision.v1" },
        result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } } },
      { id: "narrate-2", match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "Two clear knocks follow." } },
    ]);
    const play = new DesktopPlaySession(engine, model, "campaign.entity.amelia", undefined);
    const after = await play.performTurn(declaration);
    expect(after.error).toBeUndefined();
    expect(after.transcript.map((entry) => entry.speaker)).toEqual([
      "player", "narrator", "narrator",
    ]);
    expect(model.invocations.filter((call) => call.schemaId === "turn.declaration.v1")).toHaveLength(1);
    expect(model.invocations.map((call) => call.schemaId)).not.toContain("player-action.intent-interpretation.v1");
    const history = await engine.eventHistory({ types: ["test.effort-resolved"] });
    expect(history).toHaveLength(2);
    const parent = after.transcript[0]!.id;
    const replay = await engine.performPlayerAction({
      actionId: `action.${parent}.segment.1`,
      actorId: "campaign.entity.amelia",
      declaration: "I test my footing",
      budget: { maxUnits: 12000 },
    }, { modelRuntime: new ScriptedModelRuntime([]) });
    expect(replay.kind).toBe("resolved");
    expect(await engine.eventHistory({ types: ["test.effort-resolved"] })).toHaveLength(2);
  });

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
      { id: "intent", match: { schemaId: "turn.declaration.v1" }, result: { kind: "structured", value: { kind: "interpreted", segments: [{ kind: "action", goal: "leave the expected situation", targetRefs: [], modes: ["other"], statedMeans: [], requestedHorizonMs: 60_000, pressureLevel: 6 }] } } },
      { id: "arguments", match: { schemaId: "player-action.tool-arguments.v1" }, result: { kind: "structured", value: { mode: "automatic", modifier: 0, durationMs: 0, setStatus: "left-town" } } },
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
    const client = createSqlJsClient(database);
    const app = createDesktopApplication(client, options);
    const play = await app.createWorld({
      characterName: "Rowan",
      sexGender: "nonbinary",
      appearance: "Rowan has close-cropped black hair and wears a faded green rain jacket.",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      hobbies: "urban sketching and pickup basketball",
      bioHistory: "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
    });
    expect(play.view()).toEqual(expect.objectContaining({
      playerName: "Rowan",
      currentLocationName: expect.any(String),
      transcript: [expect.objectContaining({
        speaker: "narrator",
        text: expect.stringContaining("Blue frost"),
      })],
    }));
    expect((await app.listWorlds())[0]?.name).toBe("Rowan's Awakening Earth campaign");
    const sessionRows = await client.select<Array<{ generated_package_json: string }>>(
      "SELECT generated_package_json FROM desktop_play_sessions WHERE world_id = ?",
      [play.view().worldId],
    );
    const descriptor = JSON.parse(sessionRows[0]!.generated_package_json) as {
      request: { player: { name?: string; description: string } };
      seed: {
        openingSituation: {
          awakeningEvent: string;
          manifestationOpportunity: string;
        };
        pressures: Array<{ id: string; category: string }>;
      };
      openingProposal: {
        incident: {
          locationRef: string;
          involvedRefs: string[];
          groundingRefs: string[];
          contactObject: { wielderRef: string };
        };
        creature: { entityRef: string };
      };
    };
    expect(descriptor.request.player.name).toBe("Rowan");
    expect(descriptor.request.player.description).toContain("Sex/Gender: nonbinary");
    expect(descriptor.request.player.description).toContain("Appearance: Rowan has close-cropped black hair");
    expect(descriptor.request.player.description).toContain("Hobbies: urban sketching and pickup basketball");
    expect(descriptor.request.player.description).toContain("Bio / History: Rowan works at a grocery store");
    expect((await play.engineSession().eventHistory()).some((event) =>
      event.type === "campaign.opening-incident-realized"
    )).toBe(true);
    expect(play.engineSession().snapshot().actorSocialStates.find((state) =>
      state.actorId === "generated.actor.player"
    )).toEqual(expect.objectContaining({
      goals: [expect.objectContaining({
        description: expect.stringContaining("protect their sibling"),
      })],
      relationships: [],
      memories: [],
      commitments: [],
    }));
    expect((await play.engineSession().campaignPlan())?.threads).toHaveLength(3);
    await play.save("Generated save");

    // A campaign created by an older desktop build receives its missing opening
    // on first reopen, without rebuilding or replaying the world. Reopen also
    // repairs legacy ID-valued guidance and stale opaque scene references.
    const supernaturalPressureId = descriptor.seed.pressures.find((pressure) =>
      pressure.category === "supernatural"
    )!.id;
    descriptor.seed.openingSituation.awakeningEvent = supernaturalPressureId;
    descriptor.seed.openingSituation.manifestationOpportunity = supernaturalPressureId;
    descriptor.openingProposal.incident.locationRef = "scene.999";
    descriptor.openingProposal.incident.involvedRefs = ["scene.999"];
    descriptor.openingProposal.incident.groundingRefs = ["scene.999"];
    descriptor.openingProposal.incident.contactObject.wielderRef = "scene.999";
    descriptor.openingProposal.creature.entityRef = "scene.999";
    const presentationRows = await client.select<Array<{
      opening_progression_json: string;
    }>>(
      "SELECT opening_progression_json FROM desktop_play_sessions WHERE world_id = ?",
      [play.view().worldId],
    );
    const legacyOpeningProgression = JSON.parse(
      presentationRows[0]!.opening_progression_json,
    ) as Record<string, unknown>;
    legacyOpeningProgression.manifestationOpportunity = supernaturalPressureId;
    await client.execute(
      "UPDATE desktop_play_sessions SET generated_package_json = ?, transcript_json = '[]', opening_progression_json = ? WHERE world_id = ?",
      [
        JSON.stringify(descriptor),
        JSON.stringify(legacyOpeningProgression),
        play.view().worldId,
      ],
    );
    const compatibilityModel = generatedCampaignModel();

    const reopened = await createDesktopApplication(
      createSqlJsClient(database),
      { ...options, modelRuntime: compatibilityModel },
    ).openWorld(play.view().worldId);
    expect(reopened.view().transcript).toEqual([]);
    const preparingOpening = reopened.prepareOpening();
    expect(reopened.view()).toEqual(expect.objectContaining({
      busy: true,
      preparingOpening: true,
    }));
    await preparingOpening;
    expect(reopened.view().transcript).toEqual([
      expect.objectContaining({ speaker: "narrator", text: expect.stringContaining("Blue frost") }),
    ]);
    expect(compatibilityModel.invocations.map((invocation) => invocation.operation))
      .toContain("desktop.opening-narration.v1");
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


  it("starts with an inciting phenomenon and commits the first power through the real rules path on turn 1", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const model = generatedCampaignModel({
      openingSituation: {
        openingMode: "mundane-manifestation",
        supernaturalFocus: "none",
        awakeningEvent: "Rowan's first personal Awakening interrupts an otherwise ordinary grocery shift.",
        manifestationOpportunity: "The new power emerges naturally from Rowan's current ordinary action.",
        manifestationTargetTurn: 1,
        manifestationDeadlineTurns: 3,
      },
      turnSteps: openingActionSteps("mundane-turn-1", {
        includePowerManifestation: true,
      }),
    });
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `mundane-opening-${++id}`,
      nextSeed: () => 0x4545_0001,
    });

    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      bioHistory: "Rowan works at a grocery store and is in the middle of an ordinary shift.",
      allowGeneratedDetails: true,
    });

    expect(play.view().openingProgression).toEqual({
      playerTurnsSinceStart: 0,
      manifestationDeadlineTurns: 3,
      firstPowerManifested: false,
    });
    expect(play.view().transcript[0]?.text).toContain("impossible");
    expect((await play.engineSession().eventHistory()).some((event) =>
      event.type === "campaign.opening-phenomenon-realized"
    )).toBe(true);

    const afterTurn = await play.performTurn("I check the delivery list and keep working.");
    expect(afterTurn.error).toBeUndefined();
    expect(afterTurn.openingProgression).toEqual({
      playerTurnsSinceStart: 1,
      manifestationDeadlineTurns: 3,
      firstPowerManifested: true,
    });
    const manifestations = (await play.engineSession().eventHistory()).filter((event) =>
      event.type === "rules.first-power-manifested"
    );
    expect(manifestations).toHaveLength(1);
    const player = play.engineSession().snapshot().entities.find((entity) =>
      entity.id === "generated.actor.player"
    );
    expect(player?.data.mechanics).toEqual(expect.objectContaining({
      progression: expect.objectContaining({
        characterLevel: 1,
        powers: [expect.objectContaining({ id: quickChangePower.id })],
      }),
    }));
    expect(afterTurn.transcript.at(-1)?.text).toContain("weight");
  });

  it("preserves a first-turn Awakening across save/reload and later sideways choices", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const firstModel = generatedCampaignModel({
      openingSituation: {
        openingMode: "mundane-manifestation",
        supernaturalFocus: "none",
        awakeningEvent: "Rowan's first personal Awakening is close, but ordinary life continues first.",
        manifestationOpportunity: "The power can surface through whatever grounded situation Rowan creates.",
        manifestationTargetTurn: 3,
        manifestationDeadlineTurns: 3,
      },
      turnSteps: openingActionSteps("deadline-turn-1", {
        includePowerManifestation: true,
      }),
    });
    const options = {
      now: () => generatedStart,
      randomId: () => `deadline-opening-${++id}`,
      nextSeed: () => 0x4545_0002,
    };
    const app = createDesktopApplication(createSqlJsClient(database), {
      ...options,
      modelRuntime: firstModel,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      bioHistory: "Rowan works at a grocery store.",
      allowGeneratedDetails: true,
    });

    await play.performTurn("I straighten a display and keep working.");
    expect(play.view().openingProgression).toEqual({
      playerTurnsSinceStart: 1,
      manifestationDeadlineTurns: 3,
      firstPowerManifested: true,
    });
    await play.save("Before Awakening");

    const reopenedModel = generatedCampaignModel({
      turnSteps: [
        ...openingActionSteps("deadline-turn-2"),
      ],
    });
    const reopened = await createDesktopApplication(
      createSqlJsClient(database),
      { ...options, modelRuntime: reopenedModel },
    ).openWorld(play.view().worldId);

    expect(reopened.view().openingProgression).toEqual({
      playerTurnsSinceStart: 1,
      manifestationDeadlineTurns: 3,
      firstPowerManifested: true,
    });
    await reopened.performTurn("I check the time and keep working.");
    expect(reopened.view().openingProgression?.playerTurnsSinceStart).toBe(1);
    expect(reopened.view().openingProgression?.firstPowerManifested).toBe(true);
    expect((await reopened.engineSession().eventHistory()).filter((event) =>
      event.type === "rules.first-power-manifested"
    )).toHaveLength(1);
  });

  it("realizes a non-creature supernatural phenomenon without forcing the creature incident path", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const model = generatedCampaignModel({
      openingSituation: {
        openingMode: "supernatural-inciting-incident",
        supernaturalFocus: "phenomenon",
        awakeningEvent: "Every metal shelf on the loading dock begins humming in the same impossible chord.",
        manifestationOpportunity: "Rowan may awaken while reacting to or investigating the anomaly.",
        manifestationTargetTurn: 2,
        manifestationDeadlineTurns: 3,
      },
    });
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `phenomenon-opening-${++id}`,
      nextSeed: () => 0x4545_0003,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });

    const history = await play.engineSession().eventHistory();
    expect(history.some((event) => event.type === "campaign.opening-phenomenon-realized"))
      .toBe(true);
    expect(history.some((event) => event.type === "campaign.opening-incident-realized"))
      .toBe(false);
    expect(model.invocations.map((invocation) => invocation.schemaId))
      .not.toContain("awakening-earth.opening-incident-compact-v1");
    expect(play.view().transcript[0]?.text).toContain("impossible");
  });

  it("retries first-power presentation without replaying the committed Awakening", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const model = generatedCampaignModel({
      openingSituation: {
        openingMode: "mundane-manifestation",
        supernaturalFocus: "none",
        awakeningEvent: "Rowan's first personal Awakening interrupts an ordinary conversation.",
        manifestationOpportunity: "The first power surfaces after the current grounded turn.",
        manifestationTargetTurn: 1,
        manifestationDeadlineTurns: 3,
      },
      turnSteps: openingActionSteps("awakening-retry", {
        includePowerManifestation: true,
        failFirstPowerNarrationOnce: true,
      }),
    });
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `awakening-retry-${++id}`,
      nextSeed: () => 0x4545_0004,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });

    const failedPresentation = await play.performTurn("I keep sorting the delivery paperwork.");
    expect(failedPresentation.openingProgression?.firstPowerManifested).toBe(true);
    const historyAfterCommit = await play.engineSession().eventHistory();
    expect(historyAfterCommit.filter((event) =>
      event.type === "rules.first-power-manifested"
    )).toHaveLength(1);
    expect(failedPresentation.transcript.at(-1)?.text).toContain("presentation failed");

    const retried = await play.retryNarration();
    expect(retried.error).toBeUndefined();
    expect(retried.transcript.at(-1)?.text).toContain("weight");
    expect((await play.engineSession().eventHistory()).filter((event) =>
      event.type === "rules.first-power-manifested"
    )).toHaveLength(1);
    expect(await play.engineSession().eventHistory()).toEqual(historyAfterCommit);
  });

  it("retries timed-out first-power generation without replaying the completed action", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const model = generatedCampaignModel({
      openingSituation: {
        openingMode: "mundane-manifestation",
        supernaturalFocus: "none",
        awakeningEvent: "Rowan's first personal Awakening emerges from an ordinary task.",
        manifestationOpportunity: "The first power surfaces after the completed grounded turn.",
        manifestationTargetTurn: 1,
        manifestationDeadlineTurns: 3,
      },
      turnSteps: openingActionSteps("awakening-generation-retry", {
        includePowerManifestation: true,
        failFirstPowerProposalOnce: true,
      }),
    });
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `awakening-generation-retry-${++id}`,
      nextSeed: () => 0x4545_0005,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });

    const timedOut = await play.performTurn("I finish the delivery paperwork.");
    const historyAfterAction = await play.engineSession().eventHistory();
    expect(timedOut.error).toContain("completed");
    expect(timedOut.canRetryOpeningManifestation).toBe(true);
    expect(timedOut.openingProgression?.firstPowerManifested).toBe(false);
    expect(timedOut.transcript.at(-1)?.text).toContain("Retry Awakening safely");
    expect(historyAfterAction.filter((event) =>
      event.type === "rules.first-power-manifested"
    )).toHaveLength(0);

    const retried = await play.retryNarration();
    expect(retried.error).toBeUndefined();
    expect(retried.canRetryOpeningManifestation).toBe(false);
    expect(retried.openingProgression?.firstPowerManifested).toBe(true);
    expect(retried.transcript.at(-1)?.text).toContain("weight");
    expect((await play.engineSession().eventHistory()).filter((event) =>
      event.type === "rules.first-power-manifested"
    )).toHaveLength(1);
    expect((await play.engineSession().eventHistory()).filter((event) =>
      event.type === "rules.routine-task-completed"
    )).toHaveLength(
      historyAfterAction.filter((event) => event.type === "rules.routine-task-completed").length,
    );
  });

  it("accepts the minimal structured questionnaire and preserves the supplied character name", async () => {
    const { database } = await createMigratedSqlitePersistence();
    let id = 0;
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: generatedCampaignModel({ minimalPlayer: true, playerName: "Alex" }),
      now: () => generatedStart,
      randomId: () => `minimal-${++id}`,
      nextSeed: () => 0x2020_2020,
    });

    const play = await app.createWorld({
      characterName: "Alex",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });

    expect(play.view().playerName).toBe("Alex");
    expect((await app.listWorlds())[0]?.name).toBe("Alex's Awakening Earth campaign");
    const reopened = await app.openWorld(play.view().worldId);
    expect(reopened.view().playerName).toBe("Alex");
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
    const retained = await firstApplication.createWorld("Retained lifecycle");
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
    expect(await reopenedApplication.listWorlds()).toHaveLength(2);
    expect(await reopenedApplication.deleteWorld(worldId)).toEqual({
      deleted: true,
      worldId,
    });
    await expect(reopenedApplication.openWorld(worldId))
      .rejects.toThrow("metadata is missing");
    expect((await reopenedApplication.listWorlds()).map((world) => world.id))
      .toEqual([retained.view().worldId]);
    expect(await reopenedApplication.deleteWorld(worldId)).toEqual({
      deleted: false,
      worldId,
      reason: "not-found",
    });
  });

  it("runs a freeform turn through production orchestration and exposes bounded diagnostics", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Desktop smoke");
    const savedPresentation: unknown[] = [];
    const model = actionModel();
    const play = new DesktopPlaySession(
      engine,
      model,
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
    expect(view.diagnostics?.performance).toEqual(expect.objectContaining({
      modelCallCount: model.invocations.length,
      failedModelCallCount: 0,
      outcome: "resolved",
      callsMissingInputTokens: model.invocations.length,
    }));
    expect(view.diagnostics?.performance.calls.map((call) => call.schemaId))
      .toEqual(model.invocations.map((call) => call.schemaId));
    const schemaCalls = model.invocations.map((invocation) => invocation.schemaId);
    expect(schemaCalls.filter((id) => id === "turn.declaration.v1")).toHaveLength(1);
    expect(schemaCalls).not.toContain("desktop.turn-route.v1");
    expect(schemaCalls).not.toContain("player-action.intent-interpretation.v1");
    // LM-11 still owns the final authoritative stop decision; LM-03
    // eliminates model-led catalog selection for the uniquely registered operation.
    expect(schemaCalls.filter((id) => id === "player-action.execution-decision.v1"))
      .toHaveLength(1);
    expect(view.diagnostics?.stateCounts.delta.entities).toBe(0);
    expect(view.diagnostics?.stateCounts.delta.events).toBe(
      view.diagnostics!.eventCountAfter - view.diagnostics!.eventCountBefore,
    );
    expect(view.diagnostics?.stateCounts.before.entities).toBe(before.entities.length);
    expect(play.recentPerformance()).toHaveLength(1);
    expect(JSON.stringify(play.recentPerformance())).not.toContain("Authorized context");
    expect(JSON.stringify(await engine.eventHistory())).not.toContain("Authorized context");

    play.setNarrationPreference("concise");
    await play.save("Manual save");
    expect(savedPresentation).toHaveLength(3);
    expect(savedPresentation[0]).toEqual(
      expect.objectContaining({ narrationPreference: "standard" }),
    );
    expect(savedPresentation[0]).toEqual(expect.objectContaining({
      transcript: [expect.objectContaining({ speaker: "player" })],
    }));
    expect(savedPresentation[1]).toEqual(
      expect.objectContaining({ narrationPreference: "standard" }),
    );
    expect(savedPresentation[2]).toEqual(
      expect.objectContaining({ narrationPreference: "concise" }),
    );
  });

  it("shows submitted text and real action progress before completing", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Immediate player turn");
    const play = new DesktopPlaySession(
      engine,
      actionModel(),
      "campaign.entity.amelia",
      undefined,
    );
    const updates: Array<{ busy: boolean; phase?: string; text?: string }> = [];

    const pending = play.performTurn("I test my footing and press forward.", (view) => {
      updates.push({
        busy: view.busy,
        phase: view.turnProgress?.phase,
        text: view.transcript.at(-1)?.text,
      });
    });

    expect(play.view()).toEqual(expect.objectContaining({
      busy: true,
      turnProgress: expect.objectContaining({ phase: "understanding" }),
      transcript: [expect.objectContaining({
        speaker: "player",
        text: "I test my footing and press forward.",
      })],
    }));
    await expect(play.performTurn("I submit again.")).rejects.toThrow("already running");

    const completed = await pending;
    expect(updates.map((update) => update.phase)).toEqual(expect.arrayContaining([
      "understanding",
      "resolving",
      "presenting",
    ]));
    expect(updates[0]).toEqual({
      busy: true,
      phase: "understanding",
      text: "I test my footing and press forward.",
    });
    expect(completed.turnProgress).toBeUndefined();
    expect(completed.busy).toBe(false);
  });

  it("reports responding while a routed conversation awaits an NPC", async () => {
    const model = generatedCampaignModel({
      turnSteps: [
        {
          id: "route-conversation",
          match: { schemaId: "turn.declaration.v1" },
          result: (request: ModelRequest<unknown>) => {
            const context = JSON.parse(request.prompt.context!) as {
              situation: {
                scene: Array<{ localRef: string; displayIdentity: string }>;
              };
            };
            const recipientRef = context.situation.scene
              .find((item) => item.displayIdentity !== "Rowan")?.localRef;
            if (!recipientRef) throw new Error("Conversation recipient was absent from the authorized scene");
            return { kind: "structured", value: { kind: "interpreted", segments: [
              { kind: "communication", recipientRefs: [recipientRef] },
            ] } };
          },
        },
        {
          id: "interpret-conversation",
          match: { schemaId: "conversation.player-communication.v1" },
          result: {
            kind: "structured",
            value: {
              inputMode: "described",
              exactQuoteFragments: [],
              semanticKinds: ["question"],
              authorizedContent: "Ask what is happening at the loading dock.",
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
          id: "npc-response",
          match: { schemaId: "conversation.npc-decision.v1" },
          result: (request: ModelRequest<unknown>) => {
            const input = JSON.parse(request.prompt.input) as { actorRef: string };
            return {
              kind: "structured",
              value: {
                actorId: input.actorRef,
                interpretation: "The player asks about the immediate danger.",
                responseKind: "speak",
                intendedSpeechSemantics: "The NPC warns the player to stay back.",
                speechSemanticKinds: ["assertion"],
                estimatedSpeechDurationMs: 500,
                disclosure: { mode: "none" },
                sceneState: {
                  actorId: input.actorRef,
                  interpretation: "The danger at the loading dock has everyone's attention.",
                  attention: ["the player", "the loading dock"],
                  immediatePriorities: ["keep people safe"],
                  stance: "worried",
                  wants: ["avoid escalation"],
                  reluctantToRevealIds: [],
                  considering: ["whether to call for help"],
                  unresolvedQuestions: ["what caused the frost"],
                },
                requiresAuthoritativeResolution: false,
                stopReason: "answer-expected",
              },
            };
          },
        },
        {
          id: "extract-conversation",
          match: { schemaId: "conversation.durable-extraction.v1" },
          result: { kind: "structured", value: { proposals: [] } },
        },
        {
          id: "narrate-conversation",
          match: { operation: "conversation.narration.v1" },
          result: { kind: "text", text: "The NPC looks toward the frost and tells you to stay back." },
        },
      ],
    });
    const { database } = await createMigratedSqlitePersistence();
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => "conversation-progress",
      nextSeed: () => 0x1919_1919,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });
    const phases: string[] = [];
    const invocationsBeforeTurn = model.invocations.length;

    const view = await play.performTurn("I ask what is happening at the loading dock.", (update) => {
      if (update.turnProgress) phases.push(update.turnProgress.phase);
    });

    expect(phases).toContain("responding");
    expect(view.turnProgress).toBeUndefined();
    expect(view.busy).toBe(false);
    const calls = view.diagnostics?.performance.calls ?? [];
    expect(calls).toHaveLength(model.invocations.length - invocationsBeforeTurn);
    expect(calls.some((call) => call.schemaId === "turn.declaration.v1")).toBe(true);
    expect(calls.some((call) => call.schemaId === "conversation.npc-decision.v1")).toBe(true);
    expect(calls.some((call) => call.phase === "responding")).toBe(true);
  });

  it("preserves action before speech and uses updated state for NPC response", async () => {
    const model = generatedCampaignModel({
      openingSituation: { manifestationTargetTurn: 3, manifestationDeadlineTurns: 3 },
      turnSteps: [
        {
          id: "route-conversation",
          match: { schemaId: "turn.declaration.v1" },
          result: (request: ModelRequest<unknown>) => {
            const context = JSON.parse(request.prompt.context!) as {
              situation: {
                scene: Array<{ localRef: string; displayIdentity: string }>;
              };
            };
            const recipientRef = context.situation.scene
              .find((item) => item.displayIdentity !== "Rowan")?.localRef;
            if (!recipientRef) throw new Error("Conversation recipient was absent from the authorized scene");
            return { kind: "structured", value: { kind: "interpreted", segments: [
              { kind: "action", text: "I check my footing", goal: "check footing",
                modes: ["manipulation"], targetRefs: [], statedMeans: [],
                pressureLevel: 3, requestedHorizonMs: 30_000 },
              { kind: "communication", text: "ask what is happening at the loading dock",
                recipientRefs: [recipientRef] },
            ] } };
          },
        },
        {
          id: "approach-operation",
          match: { schemaId: "player-action.execution-decision.v1" },
          result: { kind: "structured", value: {
            kind: "invoke-tool", toolId: "rules.actions.complete-routine-task",
          } },
        },
        {
          id: "approach-arguments",
          match: { schemaId: "player-action.tool-arguments.v1" },
          result: { kind: "structured", value: {
            actionSummary: "Check footing before speaking", durationMs: 1_000,
          } },
        },
        {
          id: "approach-stop",
          match: { schemaId: "player-action.execution-decision.v1" },
          result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } },
        },
        {
          id: "approach-narration",
          match: { operation: "player-action.narration.v1" },
          result: { kind: "text", text: "You test your footing before speaking." },
        },
        {
          id: "interpret-conversation",
          match: { schemaId: "conversation.player-communication.v1" },
          result: {
            kind: "structured",
            value: {
              inputMode: "described",
              exactQuoteFragments: [],
              semanticKinds: ["question"],
              authorizedContent: "Ask what is happening at the loading dock.",
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
          id: "npc-response",
          match: { schemaId: "conversation.npc-decision.v1" },
          result: (request: ModelRequest<unknown>) => {
            const input = JSON.parse(request.prompt.input) as { actorRef: string };
            return {
              kind: "structured",
              value: {
                actorId: input.actorRef,
                interpretation: "The player asks about the immediate danger.",
                responseKind: "speak",
                intendedSpeechSemantics: "The NPC warns the player to stay back.",
                speechSemanticKinds: ["assertion"],
                estimatedSpeechDurationMs: 500,
                disclosure: { mode: "none" },
                sceneState: {
                  actorId: input.actorRef,
                  interpretation: "The danger at the loading dock has everyone's attention.",
                  attention: ["the player", "the loading dock"],
                  immediatePriorities: ["keep people safe"],
                  stance: "worried",
                  wants: ["avoid escalation"],
                  reluctantToRevealIds: [],
                  considering: ["whether to call for help"],
                  unresolvedQuestions: ["what caused the frost"],
                },
                requiresAuthoritativeResolution: false,
                stopReason: "answer-expected",
              },
            };
          },
        },
        {
          id: "extract-conversation",
          match: { schemaId: "conversation.durable-extraction.v1" },
          result: { kind: "structured", value: { proposals: [] } },
        },
        {
          id: "narrate-conversation",
          match: { operation: "conversation.narration.v1" },
          result: { kind: "text", text: "The NPC looks toward the frost and tells you to stay back." },
        },
      ],
    });
    const { database } = await createMigratedSqlitePersistence();
    let eventSerial = 0;
    const app = createDesktopApplication(createSqlJsClient(database), {
      modelRuntime: model,
      now: () => generatedStart,
      randomId: () => `conversation-progress-${++eventSerial}`,
      nextSeed: () => 0x1919_1919,
    });
    const play = await app.createWorld({
      characterName: "Rowan",
      locationDescription: "Medium-sized city in the Pacific Northwest.",
      allowGeneratedDetails: true,
    });
    const phases: string[] = [];
    const invocationsBeforeTurn = model.invocations.length;

    const view = await play.performTurn("I check my footing, then ask what is happening at the loading dock.", (update) => {
      if (update.turnProgress) phases.push(update.turnProgress.phase);
    });

    expect(phases).toContain("responding");
    expect(view.error).toBeUndefined();
    expect(view.transcript.map((entry) => entry.speaker)).toEqual([
      "player", "narrator", "npc",
    ]);
    expect(await play.engineSession().eventHistory({
      types: ["rules.routine-task-completed"],
    })).toHaveLength(1);
    expect((await play.engineSession().eventHistory({
      types: ["rules.communication-recorded"],
    })).length).toBeGreaterThan(0);
    expect(view.turnProgress).toBeUndefined();
    expect(view.busy).toBe(false);
    const calls = view.diagnostics?.performance.calls ?? [];
    expect(calls).toHaveLength(model.invocations.length - invocationsBeforeTurn);
    expect(calls.filter((call) => call.schemaId === "turn.declaration.v1")).toHaveLength(1);
    expect(calls.some((call) => call.schemaId === "conversation.npc-decision.v1")).toBe(true);
    expect(calls.some((call) => call.phase === "responding")).toBe(true);
  });

  it("infers an omitted investigation location instead of making the player answer a questionnaire", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Clarification continuation");
    const model = new ScriptedModelRuntime([
      {
        id: "ask-for-location",
        match: { schemaId: "turn.declaration.v1" },
        result: {
          kind: "structured",
          value: {
            kind: "player-decision-required",
            question: "Which location do you want to investigate?",
          },
        },
      },
      {
        id: "interpret-with-inferred-detail",
        match: {
          schemaId: "turn.declaration.v1",
          predicate: (request) => request.prompt.input.includes("I investigate the incident") &&
            request.prompt.input.includes("Which location do you want to investigate?"),
        },
        result: {
          kind: "structured",
          value: {
            kind: "interpreted",
            segments: [{
              kind: "action",
              goal: "begin investigating the incident from the current location",
              targetRefs: [],
              modes: ["manipulation"],
              statedMeans: [],
              requestedHorizonMs: 60_000,
              pressureLevel: 5,
            }],
          },
        },
      },
      {
        id: "arguments",
        match: { schemaId: "player-action.tool-arguments.v1" },
        result: { kind: "structured", value: {
          base: 8, modifier: 2, difficulty: 9, durationMs: 1_000,
        } },
      },
      {
        id: "stop",
        match: { schemaId: "player-action.execution-decision.v1" },
        result: { kind: "structured", value: { kind: "stop", reason: "goal-achieved" } },
      },
      {
        id: "narrate",
        match: { operation: "player-action.narration.v1" },
        result: { kind: "text", text: "You begin with the most relevant signs available here." },
      },
    ]);
    const play = new DesktopPlaySession(
      engine,
      model,
      "campaign.entity.amelia",
      undefined,
    );

    const resolved = await play.performTurn("I investigate the incident.");
    expect(resolved.error).toBeUndefined();
    expect(resolved.transcript.at(-1)).toEqual(expect.objectContaining({
      speaker: "narrator",
      text: "You begin with the most relevant signs available here.",
    }));
    expect(resolved.transcript.some((entry) => entry.speaker === "system")).toBe(false);
    expect(model.invocations.map((invocation) => invocation.schemaId))
      .not.toContain("desktop.turn-route.v1");
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
    const updates: string[] = [];
    const pending = play.performTurn("I look around.", (view) => {
      updates.push(view.turnProgress?.phase ?? "cleared");
    });
    expect(play.view()).toEqual(expect.objectContaining({
      busy: true,
      turnProgress: expect.objectContaining({ phase: "understanding" }),
      transcript: [expect.objectContaining({ speaker: "player", text: "I look around." })],
    }));
    const view = await pending;
    expect(view.error).toContain("No local model runtime");
    expect(view.diagnostics?.performance).toEqual(expect.objectContaining({
      modelCallCount: 0,
      outcome: "failed",
    }));
    expect(Object.values(view.diagnostics!.stateCounts.delta)).toEqual(
      Array(8).fill(0),
    );
    expect(view.busy).toBe(false);
    expect(view.turnProgress).toBeUndefined();
    expect(updates).toEqual(["understanding"]);
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
    expect(failed.diagnostics?.performance.outcome).toBe("committed-presentation-failed");
    expect(failed.diagnostics?.performance.modelCallCount).toBe(firstModel.invocations.length);
    expect(failed.diagnostics?.performance.calls.some((call) =>
      call.status === "failed" && call.operation === "player-action.narration.v1"
    )).toBe(true);
    const basisAfterCommit = engine.planningBasis();
    const historyAfterCommit = await engine.eventHistory();

    const retried = await play.retryNarration();
    expect(retried.transcript.at(-1)?.text).toContain("committed effort");
    expect(engine.planningBasis()).toEqual(basisAfterCommit);
    expect(await engine.eventHistory()).toEqual(historyAfterCommit);
    expect(play.recentPerformance()).toHaveLength(2);
    expect(play.recentPerformance()[1]?.turnId).toMatch(/^narration-retry\./);
    expect(play.recentPerformance()[1]?.modelCallCount).toBeGreaterThan(0);
    expect(play.recentPerformance()[1]?.outcome).toBe("resolved");
  });

  it("bounds the in-memory diagnostics ring and never creates new state for failed turns", async () => {
    const { runtime } = setup();
    const engine = await runtime.createWorld("Bounded instrumentation");
    const before = engine.snapshot();
    const beforeBasis = engine.planningBasis();
    const play = new DesktopPlaySession(engine, undefined, "campaign.entity.amelia", undefined);
    for (let i = 0; i < 22; i += 1) {
      const view = await play.performTurn("I look around the room.");
      expect(view.diagnostics?.performance.outcome).toBe("failed");
      expect(view.diagnostics?.stateCounts.delta.events).toBe(0);
    }
    expect(play.recentPerformance()).toHaveLength(20);
    expect(new Set(play.recentPerformance().map((entry) => entry.turnId)).size).toBe(20);
    expect(engine.snapshot()).toEqual(before);
    expect(engine.planningBasis()).toEqual(beforeBasis);
  });
});
