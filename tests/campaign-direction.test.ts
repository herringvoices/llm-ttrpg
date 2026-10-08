import { describe, expect, it } from "vitest";
import {
  campaignPlanDocumentSchema, changedPlanningSources, createGameRuntime,
  createInMemoryPersistence, loadGameDefinition, projectCampaignDirection,
  reviewCampaignDirection, selectCampaignReview, type CampaignPlanDocument,
  type WorldState,
} from "@llm-ttrpg/engine";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
import { contractTestGameDefinition } from "./support/contract-game.js";

const actorId = "campaign.entity.amelia";
let counter = 0;
async function worldFixture() {
  const persistence = createInMemoryPersistence();
  const runtime = createGameRuntime({
    persistence, game: loadGameDefinition(contractTestGameDefinition),
    wallClock: { now: () => "2046-01-01T00:00:00.000Z" },
    idGenerator: { next(kind: "world" | "checkpoint" | "slot" | "event" | "scheduled-trigger") {
      return `${kind}.direction-${++counter}`;
    } },
    worldSeedSource: { nextSeed: () => 119 },
  });
  const session = await runtime.createWorld("Direction tests");
  const basis = session.planningBasis();
  const thread = {
    id: "thread.planning.test", title: "A grounded, optional opening",
    summary: "Amelia has choices in the current situation.",
    kind: "developing-situation", horizon: "low" as const, priority: 80,
    status: "active" as const,
    grounding: [{ kind: "entity" as const, id: actorId }],
    related: [], playerInterestIds: [],
    currentTension: "Which direction will Amelia choose?",
    assumptions: [{
      id: "assumption.actor-status",
      summary: "Amelia is ready.",
      validation: {
        kind: "equals" as const,
        reference: { kind: "entity" as const, id: actorId, path: ["data", "status"] },
        expectedValue: "ready",
      },
      status: "valid" as const, lastEvaluatedAt: basis,
    }],
    conditionalDevelopments: [],
    lastReviewedAt: basis,
    rationale: "The character and situation already exist.",
  };
  const plan: CampaignPlanDocument = campaignPlanDocumentSchema.parse({
    schemaVersion: 1, planRevision: 0,
    basedOnWorldRevision: basis.worldRevision, basedOnEventSequence: basis.eventSequence,
    updatedAtFictionalTime: session.snapshot().fictionalTime,
    horizons: {
      high: { summary: "Several outcomes remain open.", attention: [], threadIds: [] },
      medium: { summary: "Follow consequences, not scripted beats.", attention: [], threadIds: [] },
      low: { summary: "Amelia considers her next steps.", attention: [], threadIds: [thread.id] },
    },
    threads: [thread],
    playerGoals: [{
      id: "goal.amelia", summary: "Keep my options open",
      grounding: [{ kind: "entity", id: actorId }], active: true,
    }], interestSignals: [],
  });
  return { session, plan, basis };
}

function changedStatus(before: WorldState, value: string): WorldState {
  return {
    ...before,
    entities: before.entities.map((entity) =>
      entity.id === actorId
        ? { ...entity, data: { ...entity.data, status: value } }
        : entity),
  };
}

describe("LM-08 bounded event-driven campaign direction", () => {
  it("projects a bounded private GM brief without rewriting persisted plan or player goals", async () => {
    const { plan } = await worldFixture();
    const projected = projectCampaignDirection(plan);
    expect(projected.modelText.length).toBeLessThanOrEqual(3_200);
    expect(projected.modelText).toContain("Keep my options open");
    expect(projected.modelText).toContain("Which direction will Amelia choose?");
    expect(projected.diagnostics.sourceReferences[0]?.visibility).toBe("gm-only");
    expect(projected.threadIdsByRef.get("thread.1")).toBe("thread.planning.test");
    expect(plan.schemaVersion).toBe(1);
    expect(plan.planRevision).toBe(0);
  });

  it("ignores routine unchanged turns, but indexes a changed assumption to the affected horizon", async () => {
    const { session, plan, basis } = await worldFixture();
    const before = session.snapshot();
    expect(changedPlanningSources(plan, before, before)).toEqual([]);
    const empty = selectCampaignReview({
      plan, before, after: before, playerActorId: actorId, basis,
    });
    expect(empty.reason).toBeUndefined();
    expect(empty.signals).toEqual([]);
    const after = changedStatus(before, "left-town");
    const changed = changedPlanningSources(plan, before, after);
    expect(changed.some((item) => item.reference.kind === "entity")).toBe(true);
    const selected = selectCampaignReview({
      plan, before, after, playerActorId: actorId,
      basis: { worldRevision: basis.worldRevision + 1, eventSequence: basis.eventSequence },
    });
    expect(selected.reason).toBe("material-source");
    expect(selected.horizon).toBe("low");
    expect(selected.signals).toHaveLength(1);
    expect(selected.changedRefs).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "entity", id: actorId }),
    ]));
  });

  it("handles a meaningful scene boundary without inventing a canonical change", async () => {
    const { session, plan, basis } = await worldFixture();
    const before = session.snapshot();
    const selected = selectCampaignReview({
      plan, before, after: before, playerActorId: actorId, basis,
      beforeLocationId: "place.before", afterLocationId: "place.after",
    });
    expect(selected.reason).toBe("scene-transition");
    expect(selected.changedRefs).toHaveLength(0);
    expect(selected.signals[0]?.grounding).toEqual([{ kind: "entity", id: actorId }]);
  });

  it("one compact keep decision leaves world, plan and player goals unchanged", async () => {
    const { session, plan, basis } = await worldFixture();
    const before = session.snapshot();
    const trigger = selectCampaignReview({
      plan, before, after: before, playerActorId: actorId, basis,
      beforeLocationId: "place.before", afterLocationId: "place.after",
    });
    const model = new ScriptedModelRuntime([{
      id: "keep", match: { schemaId: "campaign-direction-review.v1" },
      result: { kind: "structured", value: { kind: "keep", reason: "No grounded shift is necessary." } },
    }]);
    const reviewed = await reviewCampaignDirection({
      plan, world: before, trigger, basis, modelRuntime: model,
    });
    expect(reviewed.plan).toBeUndefined();
    expect(reviewed.diagnostic).toEqual(expect.objectContaining({
      decision: "keep", modelCalls: 1, noOp: true, planRevisionAfter: 0,
    }));
    expect(model.invocations).toHaveLength(1);
    expect(session.snapshot()).toEqual(before);
    expect((await session.eventHistory()).map((event) => event.type)).toEqual(["world.created"]);
  });

  it("a source-linked revision changes only the chosen plan thread, not canon or stated goals", async () => {
    const { session, plan, basis } = await worldFixture();
    const before = session.snapshot();
    const after = changedStatus(before, "left-town");
    const nextBasis = { worldRevision: basis.worldRevision + 1, eventSequence: basis.eventSequence };
    const trigger = selectCampaignReview({
      plan, before, after, playerActorId: actorId, basis: nextBasis,
    });
    const model = new ScriptedModelRuntime([{
      id: "revise", match: { schemaId: "campaign-direction-review.v1" },
      result: { kind: "structured", value: {
        kind: "revise-thread", threadRef: "thread.1",
        currentTension: "What follows from Amelia leaving?",
        priority: 90, reason: "A changed canonical status alters this option.",
      } },
    }]);
    const reviewed = await reviewCampaignDirection({
      plan, world: after, basis: nextBasis, trigger, modelRuntime: model,
    });
    expect(reviewed.diagnostic).toEqual(expect.objectContaining({
      decision: "revise-thread", noOp: false,
      invalidatedAssumptions: ["assumption.actor-status"],
      planRevisionAfter: 1, modelCalls: 1,
    }));
    expect(reviewed.plan?.threads[0]?.currentTension).toContain("Amelia leaving");
    expect(reviewed.plan?.playerGoals).toEqual(plan.playerGoals);
    expect(session.snapshot()).toEqual(before);
    expect((await session.eventHistory()).map((event) => event.type)).toEqual(["world.created"]);
  });

  it("rejects unselected thread refs and retains the previous valid plan", async () => {
    const { session, plan, basis } = await worldFixture();
    const before = session.snapshot();
    const trigger = selectCampaignReview({
      plan, before, after: before, playerActorId: actorId, basis,
      beforeLocationId: "one", afterLocationId: "two",
    });
    const model = new ScriptedModelRuntime([{
      id: "forge", match: { schemaId: "campaign-direction-review.v1" },
      result: { kind: "structured", value: {
        kind: "retire-thread", threadRef: "thread.5", reason: "Try to retire a missing thread.",
      } },
    }]);
    const reviewed = await reviewCampaignDirection({
      plan, world: before, basis, trigger, modelRuntime: model,
    });
    expect(reviewed.plan).toBeUndefined();
    expect(reviewed.diagnostic.decision).toBe("invalid");
    expect(reviewed.diagnostic.modelCalls).toBe(1);
    expect(session.snapshot()).toEqual(before);
  });
});
