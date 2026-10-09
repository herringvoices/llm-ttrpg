import { describe, expect, it } from "vitest";
import {
  chooseScenePressure,
  declaredDurationMs,
  scenePressureSources,
  createGameRuntime, createInMemoryPersistence, loadGameDefinition,
  canonicalFactSchema,
} from "@llm-ttrpg/engine";
import { contractTestGameDefinition } from "./support/contract-game.js";

const actorId = "campaign.entity.amelia";
const locationId = "campaign.location.brownbag-groceries";
function fixture() {
  let serial = 0;
  return createGameRuntime({
    persistence: createInMemoryPersistence(),
    game: loadGameDefinition(contractTestGameDefinition),
    wallClock: { now: () => "2045-01-01T00:00:00Z" },
    idGenerator: { next: (kind) => `${kind}.pressure-scene-${++serial}` },
    worldSeedSource: { nextSeed: () => 789 },
  });
}

describe("LM-11 source-tracked scene pressure", () => {
  it("keeps the exact nine existing time limits and retains the user's stated duration", () => {
    expect(declaredDurationMs("I look around all morning for Jonny Blonny")).toBe(14_400_000);
    expect(declaredDurationMs("I spend the morning asking about Jonny")).toBe(14_400_000);
    expect(declaredDurationMs("I search for two hours")).toBe(7_200_000);
    expect(declaredDurationMs("I check for 5 seconds")).toBe(5_000);
    expect(declaredDurationMs("I glance around")).toBeUndefined();
  });

  it("reuses an assessed urgent scene despite a new model lower-pressure proposal or world time", async () => {
    const session = await fixture().createWorld("Pressure source fingerprint");
    const base = session.snapshot();
    const old = scenePressureSources(base, actorId, locationId);
    const clockChange = scenePressureSources({
      ...base, fictionalTime: "2045-01-02T00:00:00Z" as typeof base.fictionalTime,
    }, actorId, locationId);
    expect(clockChange.fingerprint).toBe(old.fingerprint);
    expect(chooseScenePressure({ status: "assessed", level: 9 }, old, 1, clockChange))
      .toMatchObject({ level: 9, reason: "scene-reused" });
    await session.applyActionPressureAssessment({ level: 9 });
    const assessedRevision = session.planningBasis().worldRevision;
    await session.applyActionPressureAssessment({ level: 9 });
    const ensured = await session.ensureScenePressure({
      actorId, locationId, proposedLevel: 1,
    });
    expect(ensured).toMatchObject({
      level: 9, changed: false, reason: "scene-reused",
    });
    expect(session.planningBasis().worldRevision).toBe(assessedRevision);
  });

  it("honors canonical danger facts, deadlines, and a genuine end of danger", async () => {
    const session = await fixture().createWorld("Pressure clock fixture");
    const base = session.snapshot();
    const threat = canonicalFactSchema.parse({
      id: "fact.pressure.active-attack", subjectId: actorId,
      predicate: "scene.action-pressure", value: { level: 9 },
      visibility: "public", tags: ["pressure"],
    });
    const danger = scenePressureSources({
      ...base, facts: [...base.facts, threat],
    }, actorId, locationId);
    expect(danger).toMatchObject({ level: 9 });
    expect(chooseScenePressure({ status: "assessed", level: 2 }, danger, 1))
      .toMatchObject({ level: 9, reason: "authoritative-source" });
    const ended = scenePressureSources(base, actorId, locationId);
    expect(chooseScenePressure({ status: "assessed", level: 9 }, ended, 9, danger))
      .toMatchObject({ level: 3, reason: "source-ended" });
    const due = scenePressureSources({
      ...base, scheduledTriggers: [
        { id: "trigger.pressure.countdown", type: "test.countdown",
          schemaVersion: 1, sourceComponent: base.game.ruleset,
          dueAt: "2045-01-01T00:00:04Z" as typeof base.fictionalTime,
          scopeIds: [actorId], payload: {} },
      ],
      fictionalTime: "2045-01-01T00:00:00Z" as typeof base.fictionalTime,
    }, actorId, locationId);
    expect(due.level).toBe(9);
    expect(due.deadlineMs).toBe(4_000);
    const overdue = scenePressureSources({
      ...base, scheduledTriggers: [
        { id: "trigger.pressure.countdown", type: "test.countdown",
          schemaVersion: 1, sourceComponent: base.game.ruleset,
          dueAt: "2045-01-01T00:00:04Z" as typeof base.fictionalTime,
          scopeIds: [actorId], payload: {} },
      ],
      fictionalTime: "2045-01-01T00:00:12Z" as typeof base.fictionalTime,
    }, actorId, locationId);
    expect(overdue.deadlineMs).toBe(0);
    expect(overdue.level).toBe(9);
  });
});
