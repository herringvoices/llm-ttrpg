import { describe, expect, it } from "vitest";
import {
  applyPlanMutationProposal,
  createCampaignPlanContextItem,
  createEmptyCampaignPlan,
  createGameRuntime,
  createInMemoryPersistence,
  fictionalDurationMs,
  loadGameDefinition,
  PlannerStaleProposalError,
  runPlannerPass,
  validatePlanningAssumptions,
  type CampaignPlanDocument,
  type GameSession,
  type NarrativeThread,
  type PersistencePorts,
  type PlanMutationProposal,
} from "@llm-ttrpg/engine";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
import { contractTestGameDefinition } from "./support/contract-game.js";
import { createMigratedSqlitePersistence } from "./support/sqlite.js";

const ameliaId = "campaign.entity.amelia";

function dependencies(persistence: PersistencePorts) {
  let id = 0;
  let second = 0;
  return {
    persistence,
    game: loadGameDefinition(contractTestGameDefinition),
    wallClock: { now: () => new Date(Date.UTC(2045, 0, 1, 0, 0, second++)).toISOString() },
    idGenerator: {
      next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
        return `${kind}.planning-${++id}`;
      },
    },
    worldSeedSource: { nextSeed: () => 0x2800_0028 },
  };
}

function resolutionRequest(setStatus: string) {
  return {
    intent: {
      actorId: ameliaId,
      goal: "choose a different direction",
      targetIds: [] as string[],
      pressureLevel: 4 as const,
      requestedHorizonMs: fictionalDurationMs(60_000),
      authorizedHorizonMs: fictionalDurationMs(60_000),
      wasNarrowed: false,
    },
    operation: {
      id: "test.resolution.resolve-contract-fixture",
      input: { actorId: ameliaId, mode: "automatic", modifier: 0, durationMs: 0, setStatus },
    },
  };
}

function thread(
  id: string,
  horizon: "high" | "medium" | "low",
  basis: { worldRevision: number; eventSequence: number },
  extras: Partial<NarrativeThread> = {},
): NarrativeThread {
  return {
    id,
    title: `${horizon} campaign thread`,
    summary: `Grounded ${horizon}-horizon attention for Amelia.`,
    kind: "developing-situation",
    horizon,
    priority: 60,
    status: "active",
    grounding: [{ kind: "entity", id: ameliaId }],
    related: [],
    playerInterestIds: [],
    currentTension: "What will Amelia choose next?",
    assumptions: [],
    conditionalDevelopments: [{
      id: `development.${horizon}`,
      summary: "Amelia may revisit this pressure if it remains relevant.",
      condition: "The underlying canonical situation continues.",
      grounding: [{ kind: "entity", id: ameliaId }],
      rationale: "A possibility for attention, not a scheduled action.",
    }],
    lastReviewedAt: basis,
    rationale: "Prefer an established actor and consequence over arbitrary novelty.",
    ...extras,
  };
}

function proposal(
  planRevision: number,
  horizon: "high" | "medium" | "low",
  basis: { worldRevision: number; eventSequence: number },
  mutations: PlanMutationProposal["mutations"],
  consumedSignalIds: string[] = [],
): PlanMutationProposal {
  return {
    requestedHorizon: horizon,
    basedOnPlanRevision: planRevision,
    basedOnWorldRevision: basis.worldRevision,
    basedOnEventSequence: basis.eventSequence,
    consumedSignalIds,
    mutations,
    rationale: `Review ${horizon} attention from current canonical state.`,
  };
}

async function commitPass(
  session: GameSession,
  plan: CampaignPlanDocument,
  horizon: "high" | "medium" | "low",
  output: PlanMutationProposal,
  signals: Parameters<typeof runPlannerPass>[0]["signals"] = [],
) {
  const basis = session.planningBasis();
  const model = new ScriptedModelRuntime([{
    id: `planner-${horizon}`,
    match: { operation: "campaign-planner", schemaId: "campaign-plan-mutation-proposal.v1" },
    result: { kind: "structured", value: output },
  }]);
  const result = await runPlannerPass({
    modelRuntime: model,
    plan,
    horizon,
    signals,
    world: session.snapshot(),
    history: await session.eventHistory(),
    ...basis,
  });
  expect(result.ok).toBe(true);
  expect(result.plan).toBeDefined();
  expect(result.diagnostic?.canonicalMutationCount).toBe(0);
  return {
    plan: await session.commitCampaignPlan(plan.planRevision, result.plan!),
    diagnostic: result.diagnostic!,
  };
}

async function exercisePlanner(persistence: PersistencePorts) {
  const runtime = createGameRuntime(dependencies(persistence));
  const session = await runtime.createWorld("Adaptive campaign");
  await session.resolve(resolutionRequest("ready"));
  const basis = session.planningBasis();
  const beforePlanWorld = session.snapshot();
  const beforePlanHistory = await session.eventHistory();
  let plan = await session.initializeCampaignPlan(createEmptyCampaignPlan({
    ...basis,
    fictionalTime: session.snapshot().fictionalTime,
  }));

  const high = thread("thread.long-conflict", "high", basis);
  plan = (await commitPass(session, plan, "high", proposal(0, "high", basis, [
    { kind: "upsert-thread", thread: high },
    { kind: "set-horizon", summary: "Amelia's choices shape a durable conflict.", attention: ["Keep several end states possible."] },
    { kind: "upsert-player-goal", goal: { id: "goal.amelia-direction", summary: "Amelia wants to choose her own direction.", grounding: [{ kind: "entity", id: ameliaId }], active: true } },
  ]))).plan;

  const medium = thread("thread.current-arc", "medium", basis);
  plan = (await commitPass(session, plan, "medium", proposal(1, "medium", basis, [
    { kind: "upsert-thread", thread: medium },
    { kind: "set-horizon", summary: "The current arc follows the consequences of Amelia's choice.", attention: ["Develop established relationships."] },
  ]))).plan;

  const low = thread("thread.next-scenes", "low", basis, {
    assumptions: [{
      id: "assumption.amelia-ready",
      summary: "Amelia remains ready to follow the expected opportunity.",
      validation: { kind: "equals", reference: { kind: "entity", id: ameliaId, path: ["data", "status"] }, expectedValue: "ready" },
      status: "valid",
      lastEvaluatedAt: basis,
    }],
  });
  plan = (await commitPass(session, plan, "low", proposal(2, "low", basis, [
    { kind: "upsert-thread", thread: low },
    { kind: "set-horizon", summary: "Near-term attention follows Amelia's current opportunity.", attention: ["Surface an established callback if relevant."] },
  ]))).plan;

  expect(session.snapshot()).toEqual(beforePlanWorld);
  expect(await session.eventHistory()).toEqual(beforePlanHistory);
  expect(session.planningBasis()).toEqual(basis);
  expect(plan.planRevision).toBe(3);

  const plannerItem = createCampaignPlanContextItem(plan);
  const actorContext = session.assembleContext({
    role: "actor",
    perspective: { kind: "actor", id: ameliaId },
    focalActorId: ameliaId,
    budget: { maxUnits: 50_000 },
  }, { retrieved: [plannerItem] });
  const plannerContext = session.assembleContext({
    role: "planner",
    perspective: { kind: "canonical" },
    budget: { maxUnits: 50_000 },
  }, { retrieved: [plannerItem] });
  expect(JSON.stringify(actorContext)).not.toContain("thread.next-scenes");
  expect(JSON.stringify(plannerContext)).toContain("thread.next-scenes");

  const oldSlot = await session.save("Before surprise");
  const checkpointPlan = await persistence.planner.loadCheckpoint(oldSlot.checkpointId);
  expect(checkpointPlan?.planRevision).toBe(3);

  await session.resolve(resolutionRequest("left-town"));
  const changedBasis = session.planningBasis();
  const checked = validatePlanningAssumptions({
    plan,
    world: session.snapshot(),
    history: await session.eventHistory(),
    ...changedBasis,
  });
  expect(checked.invalidatedIds).toEqual(["assumption.amelia-ready"]);
  expect(checked.signals).toHaveLength(1);

  const revisedLow = thread("thread.next-scenes", "low", changedBasis, {
    priority: 90,
    currentTension: "What follows from Amelia leaving town?",
    assumptions: checked.plan.threads.find((candidate) => candidate.id === "thread.next-scenes")!.assumptions,
  });
  const lowResult = await commitPass(session, plan, "low", proposal(
    3,
    "low",
    changedBasis,
    [
      { kind: "upsert-thread", thread: revisedLow },
      { kind: "set-horizon", summary: "Adapt near-term attention to Amelia leaving town.", attention: ["Follow consequences without forcing her return."] },
      { kind: "request-escalation", to: "medium", reason: "The unexpected departure changes the current arc." },
    ],
    checked.signals.map((signal) => signal.id),
  ), checked.signals);
  plan = lowResult.plan;
  expect(lowResult.diagnostic.escalationRequested).toBe("medium");

  const highBeforeMedium = plan.horizons.high;
  const revisedMedium = thread("thread.current-arc", "medium", changedBasis, {
    currentTension: "How do established pressures develop after Amelia's departure?",
  });
  plan = (await commitPass(session, plan, "medium", proposal(4, "medium", changedBasis, [
    { kind: "upsert-thread", thread: revisedMedium },
    { kind: "set-horizon", summary: "The arc adapts to Amelia's departure.", attention: ["Reuse established pressures in the changed location."] },
  ]))).plan;
  expect(plan.horizons.high).toEqual(highBeforeMedium);
  expect(session.snapshot().entities.find((entity) => entity.id === ameliaId)?.data.status).toBe("left-town");

  const branched = await runtime.createWorldFromCheckpoint(oldSlot.checkpointId, "Earlier branch");
  const branchPlan = await branched.campaignPlan();
  expect(branchPlan?.planRevision).toBe(3);
  expect(branchPlan?.horizons.low.summary).toContain("current opportunity");
  expect(branchPlan?.horizons.low.summary).not.toContain("leaving town");
  expect(branched.snapshot().entities.find((entity) => entity.id === ameliaId)?.data.status).toBe("ready");
}

describe("persistent campaign planning and narrative direction", () => {
  it("replans adaptively without changing canon and restores checkpoint plans in memory", async () => {
    await exercisePlanner(createInMemoryPersistence());
  });

  it("persists plan revisions and checkpoint branches through SQLite", async () => {
    const { persistence } = await createMigratedSqlitePersistence();
    await exercisePlanner(persistence);
  });

  it("rejects stale and cross-horizon proposals without changing the plan", () => {
    const game = loadGameDefinition(contractTestGameDefinition);
    const world = game.campaign.content;
    expect(world).toBeDefined();
    const plan = createEmptyCampaignPlan({
      worldRevision: 0,
      eventSequence: 0,
      fictionalTime: "2045-01-01T00:00:00.000Z",
    });
    const initializedWorld = {
      ...game.campaign.content,
    };
    expect(() => applyPlanMutationProposal({
      plan,
      proposal: proposal(0, "low", { worldRevision: 0, eventSequence: 0 }, []),
      signals: [],
      world: initializedWorld as never,
      worldRevision: 1,
      eventSequence: 0,
    })).toThrow(PlannerStaleProposalError);
    expect(plan.planRevision).toBe(0);
  });
});
