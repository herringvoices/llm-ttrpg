import { describe, expect, it } from "vitest";
import {
  createGameRuntime, createInMemoryPersistence, loadGameDefinition,
  immutableOperationWorldView, type GameDefinition,
} from "@llm-ttrpg/engine";
import {
  prepareReferenceActionAttempt, referenceGameDefinition,
} from "../src/index.js";

const playerId = "campaign.entity.amelia";
const locationId = "campaign.location.brownbag-groceries";
const observationId = "fact.observation.cashier-one";
const observationTwoId = "fact.observation.cashier-two";
const extra = {
  id: "campaign.entity.unrealized-bystander",
  kind: "actor" as const, name: "Bystander", summary: "A present untrained witness.",
  data: {},
};
const observation = (id: string) => ({
  id, subjectId: locationId, predicate: "person.observed",
  value: {
    label: "An unknown store clerk",
    summary: "The clerk is present at the register during the encounter.",
    disclosedName: "Mara",
  },
  visibility: "public" as const, tags: ["person", "observation"],
});
function setup() {
  const base = referenceGameDefinition;
  const definition: GameDefinition = {
    ...base,
    campaign: {
      ...base.campaign, content: {
        ...base.campaign.content,
        entities: [...base.campaign.content.entities, extra],
        facts: [...base.campaign.content.facts,
          observation(observationId), observation(observationTwoId)],
      },
    },
  };
  const game = loadGameDefinition(definition);
  const persistence = createInMemoryPersistence();
  let id = 0;
  const dependencies = {
    game, persistence,
    wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
    idGenerator: { next: (kind: string) => `${kind}.lm10-${++id}` },
    worldSeedSource: { nextSeed: () => 101010 },
  };
  return { dependencies, runtime: createGameRuntime(dependencies), persistence };
}
function personRequest(sourceId: string, level: "ephemeral" | "identified" | "persistent",
  time: string) {
  return {
    kind: "person-identity" as const, sourceId, actorId: playerId,
    scopeId: locationId, fictionalTime: time,
    trigger: { kind: "meaningful-interaction" as const, id: "event.lm10.actual-conversation" },
    perspective: { kind: "actor" as const, id: playerId },
    required: [`fact:${sourceId}:identity`], targetLevel: level,
    idempotencyKey: `realization.person.${sourceId}.${level}`,
    budget: { maxTargets: 1 as const, maxModelCalls: 0 },
  };
}
function mechanicRequest(time: string) {
  return {
    kind: "mechanics" as const, sourceId: extra.id, actorId: playerId,
    fictionalTime: time,
    trigger: { kind: "validated-action" as const, id: "action.lm10.defense-check" },
    perspective: { kind: "actor" as const, id: playerId },
    required: [`entity:${extra.id}:mechanics`],
    targetLevel: "complete" as const,
    idempotencyKey: "realization.lm10.bystander-mechanics",
    budget: { maxTargets: 1 as const, maxModelCalls: 0 },
  };
}

describe("LM-10 source-grounded on-demand realization", () => {
  it("creates one minimum mechanical state without backfilling powers, rolling, or regenerating on reopen", async () => {
    const { dependencies, runtime } = setup();
    const session = await runtime.createWorld("On-demand mechanics");
    const initial = session.snapshot();
    const beforeRng = JSON.stringify(initial.randomness);
    const request = mechanicRequest(initial.fictionalTime);
    const first = await session.realize(request);
    expect(first.status).toBe("realized");
    const second = await session.realize(request);
    expect(second.status).toBe("already-sufficient");
    expect(session.snapshot().entities.find((entity) => entity.id === extra.id)?.data.mechanics)
      .toEqual(expect.objectContaining({
        skills: [], statuses: [], isPlayerCharacter: false,
        attributes: expect.objectContaining({ agility: 56, perception: 56 }),
      }));
    expect(JSON.stringify(session.snapshot().randomness)).toBe(beforeRng);
    expect((await session.eventHistory({ types: ["rules.mechanics-realized"] }))).toHaveLength(1);
    const prepared = prepareReferenceActionAttempt({
      operationId: "rules.actions.resolve-action",
      attempt: {
        actionId: "action.lm10.defense-check", actorId: playerId,
        declaration: "I attack the bystander.", goal: "Strike an opponent",
        targetIds: [extra.id], modes: ["attack"], statedMeans: [],
        pressureLevel: 8, requestedHorizonMs: 5_000,
        authorizedHorizonMs: 5_000, remainingHorizonMs: 5_000,
      },
      world: immutableOperationWorldView(session.snapshot()),
    });
    expect(prepared.status).toBe("ready");
    await session.save("After realization");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    expect(await reopened.realize(request)).toMatchObject({ status: "already-sufficient" });
    expect((await reopened.eventHistory({ types: ["rules.mechanics-realized"] }))).toHaveLength(1);
  });

  it("does not realize ambient names; an observed source is reused through identity promotion and save/reopen", async () => {
    const { dependencies, runtime } = setup();
    const session = await runtime.createWorld("Clerk encounter");
    const time = session.snapshot().fictionalTime;
    const count = session.snapshot().entities.length;
    expect(session.snapshot().entities).toHaveLength(count);
    const first = await session.realize(personRequest(observationId, "ephemeral", time));
    expect(first.status).toBe("realized");
    const sourceId = first.sourceId;
    const clerk = session.snapshot().entities.find((entity) =>
      entity.data["observation-source-id"] === sourceId);
    expect(clerk?.data.mechanics).toBeUndefined();
    expect(session.snapshot().actorSocialStates.some((state) =>
      state.actorId === clerk?.id)).toBe(false);
    expect(await session.realize(personRequest(observationId, "ephemeral", time)))
      .toMatchObject({ status: "already-sufficient" });
    expect(await session.realize(personRequest(observationId, "identified", time)))
      .toMatchObject({ status: "realized" });
    await session.save("Clerk learned");
    const reopened = await createGameRuntime(dependencies).openWorld(session.worldId);
    expect(await reopened.realize(personRequest(observationId, "persistent", time)))
      .toMatchObject({ status: "realized" });
    expect(reopened.snapshot().actorSocialStates.some((state) =>
      state.actorId === clerk?.id)).toBe(true);
    const clerkAfter = reopened.snapshot().entities.filter((entity) =>
      entity.data["observation-source-id"] === sourceId);
    expect(clerkAfter).toHaveLength(1);
    expect(await reopened.realize(personRequest(observationId, "persistent", time)))
      .toMatchObject({ status: "already-sufficient" });
    const other = await reopened.realize(personRequest(observationTwoId, "identified", time));
    expect(other.status).toBe("realized");
    expect(reopened.snapshot().entities.filter((entity) =>
      entity.data["observation-source-id"] === observationTwoId)).toHaveLength(1);
    expect(reopened.snapshot().entities.find((entity) =>
      entity.data["observation-source-id"] === observationTwoId)?.id).not.toBe(clerk?.id);
  });

  it("reuses exact same-parent/sibling rooms, commits a route once, and does not make incidental mentions permanent", async () => {
    const { runtime } = setup();
    const session = await runtime.createWorld("Places");
    const count = session.snapshot().entities.length;
    expect(session.snapshot().entities).toHaveLength(count);
    const first = await session.executeOperation<{ toLocationId: string; created: boolean }>(
      "rules.actions.enter-local-place",
      { actorId: playerId, placeName: "Back Office", travelDurationMs: 0 },
    );
    expect(first.created).toBe(true);
    const again = await session.executeOperation<{ toLocationId: string; created: boolean }>(
      "rules.actions.enter-local-place",
      { actorId: playerId, placeName: " Back   Office ", travelDurationMs: 0 },
    );
    expect(again).toMatchObject({ created: false, toLocationId: first.toLocationId });
    const another = await session.executeOperation<{ toLocationId: string; created: boolean }>(
      "rules.actions.enter-local-place",
      { actorId: playerId, placeName: "Stock Room", travelDurationMs: 0 },
    );
    expect(another.created).toBe(true);
    const sibling = await session.executeOperation<{ toLocationId: string; created: boolean }>(
      "rules.actions.enter-local-place",
      { actorId: playerId, placeName: "back office", travelDurationMs: 0 },
    );
    expect(sibling).toMatchObject({ created: false, toLocationId: first.toLocationId });
    const routeId = `state.fact.route.${first.toLocationId}`;
    expect(session.snapshot().facts.filter((fact) => fact.id === routeId)).toHaveLength(1);
    expect(session.snapshot().facts.find((fact) => fact.id === routeId)?.predicate).toBe("location.route");
  });

  it("does not make an unknown source canonical or fall back to package-specific engine defaults", async () => {
    const { runtime } = setup();
    const session = await runtime.createWorld("Unauthorized source");
    const before = JSON.stringify(session.snapshot());
    const bad = await session.realize(personRequest("fact.observation.nonexistent", "persistent",
      session.snapshot().fictionalTime));
    expect(bad.status).toBe("unavailable");
    expect(JSON.stringify(session.snapshot())).toBe(before);
    expect(await session.realize({
      ...mechanicRequest(session.snapshot().fictionalTime),
      perspective: { kind: "actor", id: "campaign.entity.nina" },
    })).toMatchObject({ status: "unavailable" });
  });
});
