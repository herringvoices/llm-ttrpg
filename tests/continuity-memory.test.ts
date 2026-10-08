import { describe, expect, it } from "vitest";
import {
  canonicalEventSchema,
  assessContinuityFreshness,
  condenseContinuityAtBoundary,
  createGameRuntime,
  createInMemoryPersistence,
  fictionalInstant,
  loadGameDefinition,
  projectContinuity,
  recallContinuity,
  type WorldState,
  type ContinuityRequest,
  type ModelRuntime,
} from "@llm-ttrpg/engine";
import { referenceGameDefinition } from "@llm-ttrpg/reference-game";

const nina = "campaign.entity.nina";
const manager = "campaign.entity.brownbag-manager";
const location = "campaign.location.brownbag-groceries";
let serial = 0;
async function fixture() {
  const persistence = createInMemoryPersistence();
  let id = 0;
  const runtime = createGameRuntime({
    persistence,
    game: loadGameDefinition(referenceGameDefinition),
    wallClock: { now: () => "2042-01-01T00:00:00.000Z" },
    idGenerator: { next: (kind) => `${kind}.continuity-${++id}` },
    worldSeedSource: { nextSeed: () => 0x1177_1177 },
  });
  const session = await runtime.createWorld("Continuity fixture");
  return { session, world: session.snapshot() };
}
function input(world: WorldState, actor = nina, scope: ContinuityRequest["scope"] = { kind: "actor", id: actor }): ContinuityRequest {
  return {
    worldId: `world.continuity-test-${serial}`,
    world,
    worldRevision: 1,
    eventSequence: 1,
    perspective: { kind: "actor", id: actor },
    scope,
    maxCharacters: 950,
  };
}

describe("LM-07 continuity source selection and perspective", () => {
  it("does not give one NPC another NPC's goals or beliefs or any hidden fact", async () => {
    serial++;
    const { world } = await fixture();
    world.facts.push({
      id: "fact.continuity.secret",
      subjectId: location,
      predicate: "location.private-secrets",
      value: "The owner secretly stole the medication.",
      visibility: "hidden",
      tags: ["clue"],
    });
    world.beliefs.push({
      id: "belief.continuity.nina-private",
      holder: { kind: "actor", id: nina },
      subjectId: location,
      proposition: "Nina thinks a ghost watches the freezer.",
      truthStatus: "false",
      confidence: 0.4,
    });
    const ninaSummary = projectContinuity(input(world)).summary;
    const managerSummary = projectContinuity(input(world, manager)).summary;
    expect(ninaSummary.summaryText).toContain("Keep steady hours");
    expect(ninaSummary.summaryText).toContain("Believes (not confirmed fact)");
    expect(ninaSummary.summaryText).toContain("ghost watches the freezer");
    expect(ninaSummary.summaryText).not.toContain("operating despite");
    expect(ninaSummary.summaryText).not.toContain("stole the medication");
    expect(managerSummary.summaryText).toContain("operating despite");
    expect(managerSummary.summaryText).not.toContain("ghost watches");
    expect(managerSummary.summaryText).not.toContain("Keep steady hours");
    expect(JSON.stringify(ninaSummary)).not.toContain("truthStatus");
    expect(ninaSummary.sourceRefs.some((source) => source.id === "belief.continuity.nina-private")).toBe(true);
    expect(ninaSummary.summaryText.length).toBeLessThanOrEqual(950);
  });

  it("caches past unrelated revisions but invalidates on a relevant material source update", async () => {
    serial++;
    const { world } = await fixture();
    const base = input(world);
    const first = projectContinuity(base);
    expect(first.diagnostics.trigger).toBe("initial");
    const routine = projectContinuity({ ...base, worldRevision: 55, eventSequence: 6 });
    expect(routine.diagnostics.trigger).toBe("cache-hit");
    expect(routine.diagnostics.refreshed).toBe(false);
    expect(routine.summary.summaryText).toBe(first.summary.summaryText);
    const social = world.actorSocialStates.find((item) => item.actorId === nina)!;
    social.goals[0]!.description = "Secure emergency medicine for the neighborhood.";
    const changed = projectContinuity({ ...base, worldRevision: 56, eventSequence: 7 });
    expect(changed.diagnostics.trigger).toBe("material-sources-changed");
    expect(changed.summary.summaryText).toContain("Secure emergency medicine");
    expect(changed.summary.summaryText).not.toContain("Keep steady hours");
    expect(changed.summary.basis.sourceFingerprint).not.toBe(first.summary.basis.sourceFingerprint);
    expect(first.summary.summaryText).toContain("Keep steady hours");
  });

  it("keeps player-established backstory without treating an omniscient entity summary as actor knowledge", async () => {
    serial++;
    const { world } = await fixture();
    world.entities.find((item) => item.id === nina)!.summary =
      "GM secret: Nina's suspicions are wrong and she is unknowingly watched.";
    const realization = world.mechanicalRealizations.find((item) => item.entityId === nina);
    if (realization) {
      realization.constraints.push({
        id: "constraint.nina.player-established-background",
        sourceKind: "player-established",
        sourceId: "fact.player-established-nina",
        summary: "Nina grew up helping her grandfather repair bicycles.",
      });
    } else {
      world.mechanicalRealizations.push({
        entityId: nina,
        level: "constrained",
        constraints: [{
          id: "constraint.nina.player-established-background",
          sourceKind: "player-established",
          sourceId: "fact.player-established-nina",
          summary: "Nina grew up helping her grandfather repair bicycles.",
        }],
        history: [],
      });
    }
    const summary = projectContinuity(input(world)).summary;
    expect(summary.summaryText).toContain("repair bicycles");
    expect(summary.summaryText).not.toContain("GM secret");
    expect(summary.summaryText).not.toContain("suspicions are wrong");
    expect(summary.sourceRefs).toContainEqual({
      kind: "player-established",
      id: "constraint.nina.player-established-background",
    });
  });

  it("caps high-value obligations ahead of trivial recency and retains established backstory", async () => {
    serial++;
    const { world } = await fixture();
    const social = world.actorSocialStates.find((item) => item.actorId === nina)!;
    social.commitments.push({
      id: "commitment.continuity.medicine",
      label: "Bring medicine to the clinic before evening",
      start: world.fictionalTime,
      end: fictionalInstant("2026-04-12T18:00:00.000Z"),
      availabilityImpact: "occupied",
      relatedEntityIds: [location],
      tags: ["delivery"],
    });
    for (let i = 0; i < 40; i++) {
      social.memories.push({
        id: `memory.continuity.small-talk-${i}`,
        summary: `Small talk about the weather ${i}`,
        formedAt: world.fictionalTime,
        salience: 0.1,
        relatedEntityIds: [location],
        sourceEventIds: [],
        tags: ["incidental"],
      });
    }
    const projected = projectContinuity(input(world, nina, { kind: "actor", id: nina }));
    expect(projected.summary.summaryText).toContain("Bring medicine");
    expect(projected.summary.summaryText).toContain("Keep steady hours");
    expect(projected.summary.summaryText.length).toBeLessThanOrEqual(950);
    expect(projected.diagnostics.omittedSourceCount).toBeGreaterThan(0);
    expect(projected.summary.points.length).toBeLessThanOrEqual(12);
    expect(projected.summary.sourceRefs.length).toBeLessThanOrEqual(24);
  });

  it("targeted recall selects only actor-authorized sources, never GM events or unrelated history", async () => {
    serial++;
    const { world } = await fixture();
    const publicEvent = canonicalEventSchema.parse({
      id: "event.continuity.public-clinic",
      type: "rules.route-traversed",
      schemaVersion: 1,
      sourceComponent: referenceGameDefinition.ruleset.identity,
      occurredAt: world.fictionalTime,
      sequence: 2,
      summary: "Nina watched the clinic delivery finally arrive.",
      relatedEntityIds: [nina, location],
      scopeIds: [location],
      causedByEventIds: [],
      payload: {},
      access: "public",
    });
    const privateEvent = canonicalEventSchema.parse({
      ...publicEvent,
      id: "event.continuity.gm-secret",
      summary: "The clinic delivery secretly contained stolen treasure.",
      access: "gm-only",
      sequence: 3,
    });
    const unrelated = canonicalEventSchema.parse({
      ...publicEvent,
      id: "event.continuity.other",
      summary: "The clinic delivery vanished in another town.",
      relatedEntityIds: ["campaign.entity.amelia"],
      sequence: 4,
    });
    const recalled = recallContinuity({
      ...input(world),
      events: [publicEvent, privateEvent, unrelated],
      query: "What happened to the clinic delivery?",
      limit: 4,
    });
    expect(recalled.summaryText).toContain("delivery finally arrive");
    expect(recalled.summaryText).not.toContain("stolen treasure");
    expect(recalled.summaryText).not.toContain("another town");
    expect(recalled.sourceRefs).toEqual(
      expect.arrayContaining([{ kind: "event", id: publicEvent.id }]),
    );
    expect(recalled.sourceRefs.some((ref) => ref.id === privateEvent.id)).toBe(false);
    const noMatches = recallContinuity({ ...input(world), query: "unrecorded password" });
    expect(noMatches.summaryText).toBe("");
  });

  it("marks contradicted held summaries stale without leaking their previous text", async () => {
    serial++;
    const { world } = await fixture();
    const req = input(world);
    const original = projectContinuity(req).summary;
    expect(assessContinuityFreshness(original, { ...req, worldRevision: 9 }).status).toBe("current");
    world.actorSocialStates.find((item) => item.actorId === nina)!.goals[0]!.description =
      "A new material goal replaces the old one.";
    const old = assessContinuityFreshness(original, { ...req, worldRevision: 10 });
    expect(old.status).toBe("stale");
    expect(old.summaryText).toBe("");
    expect(old.points).toEqual([]);
    const current = projectContinuity({ ...req, worldRevision: 10 }).summary;
    expect(current.summaryText).toContain("new material goal");
  });

  it("rejects fabricated model positions and retains mandatory obligations on optional condensation", async () => {
    serial++;
    const { world } = await fixture();
    const social = world.actorSocialStates.find((item) => item.actorId === nina)!;
    social.commitments.push({
      id: "commitment.continuity.doctor",
      label: "Bring the doctor's medicine",
      start: world.fictionalTime,
      end: fictionalInstant("2026-04-12T18:00:00.000Z"),
      availabilityImpact: "occupied",
      relatedEntityIds: [location],
      tags: [],
    });
    for (let i = 0; i < 10; i++) {
      social.memories.push({
        id: `memory.continuity.condense-${i}`,
        summary: `A different authorized errand ${i}`,
        formedAt: world.fictionalTime,
        salience: 0.5,
        relatedEntityIds: [location],
        sourceEventIds: [], tags: [],
      });
    }
    const original = projectContinuity(input(world, nina, { kind: "actor", id: nina })).summary;
    expect(original.points.length).toBeGreaterThan(6);
    let invocations = 0;
    const malicious = {
      async generate() {
        invocations++;
        return { ok: true, output: { kind: "structured", value: { selectedPositions: [999] } } };
      },
    } as unknown as ModelRuntime;
    const refused = await condenseContinuityAtBoundary({
      summary: original, modelRuntime: malicious, trigger: "material-event",
    });
    expect(invocations).toBe(1);
    expect(refused.summary).toEqual(original);
    expect(refused.diagnostics.fallbackReason).toBe("unauthorized-source-position");

    const required = original.points.flatMap((point, i) =>
      /^(?:Active obligation:|Established personal history:)/.test(point.text) ? [i] : []);
    const safeModel = {
      async generate(request: { prompt: { input: string } }) {
        invocations++;
        expect(request.prompt.input).not.toContain("commitment.continuity.doctor");
        return {
          ok: true,
          output: { kind: "structured", value: { selectedPositions: required } },
        };
      },
    } as unknown as ModelRuntime;
    const accepted = await condenseContinuityAtBoundary({
      summary: original, modelRuntime: safeModel,
      trigger: "scene-transition", maxCharacters: 900,
    });
    expect(accepted.diagnostics.usedModel).toBe(true);
    expect(accepted.summary.summaryText).toContain("doctor's medicine");
    expect(accepted.summary.points.length).toBe(required.length);
    expect(accepted.summary.sourceRefs).toEqual(
      accepted.summary.points.flatMap((point) => point.sourceRefs),
    );
    expect(invocations).toBe(2);
  });

  it("recreates a matching summary from saved authoritative state without storing the projection in canon", async () => {
    serial++;
    const { session } = await fixture();
    const baseline = projectContinuity(input(session.snapshot())).summary.summaryText;
    const save = await session.save("Before continuity reopen");
    expect(save.checkpointId).toBeTruthy();
    expect(JSON.stringify(session.snapshot())).not.toContain("summaryText");
    const rebuilt = projectContinuity({
      ...input(session.snapshot()), worldId: "world.new-runtime-opened",
    });
    expect(rebuilt.diagnostics.trigger).toBe("initial");
    expect(rebuilt.summary.summaryText).toBe(baseline);
  });
});
