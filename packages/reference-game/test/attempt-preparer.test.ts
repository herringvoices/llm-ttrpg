import { describe, expect, it } from "vitest";
import {
  immutableOperationWorldView,
  initializeCampaignWorld,
  loadGameDefinition,
  type SemanticActionAttempt,
} from "@llm-ttrpg/engine";
import {
  prepareReferenceActionAttempt,
  referenceGameDefinition,
  resolveActionInputSchema,
} from "../src/index.js";

const playerId = "campaign.entity.amelia";
const locationId = "campaign.location.brownbag-groceries";
function fixture() {
  return initializeCampaignWorld(loadGameDefinition(referenceGameDefinition), 12345);
}
function attempt(overrides: Partial<SemanticActionAttempt> = {}): SemanticActionAttempt {
  return {
    actionId: "action.test.mechanical-plan",
    actorId: playerId,
    declaration: "I inspect the aging refrigeration.",
    goal: "Inspect the refrigeration",
    targetIds: [locationId],
    modes: ["observation"],
    statedMeans: [],
    pressureLevel: 5,
    requestedHorizonMs: 10_000,
    authorizedHorizonMs: 10_000,
    remainingHorizonMs: 10_000,
    ...overrides,
  };
}
function prepare(
  overrides: Partial<SemanticActionAttempt> = {},
  update?: (world: ReturnType<typeof fixture>) => void,
) {
  const world = fixture();
  update?.(world);
  return prepareReferenceActionAttempt({
    operationId: "rules.actions.resolve-action",
    attempt: attempt(overrides),
    world: immutableOperationWorldView(world),
  });
}

describe("LM-04 ruleset-owned action preparation", () => {
  it("derives a complete observation check from established mechanics, without a model plan", () => {
    const first = prepare();
    const second = prepare();
    expect(first).toEqual(second);
    expect(first.status).toBe("ready");
    if (first.status !== "ready") return;
    const input = resolveActionInputSchema.parse(first.input);
    expect(input.performance.attributeIds).toEqual(["perception", "focus"]);
    expect(input.performance.applicableSkillIds).toEqual([]);
    expect(input.performance.attributeModifiers).toEqual([]);
    expect(input.performance.performanceModifiers).toEqual([]);
    expect(input.performance.helpers).toEqual([]);
    expect(input.performance.combinedAttributeContributions).toEqual([]);
    expect(input.resistance).toEqual({
      kind: "fixed",
      value: 55,
      provenance: {
        kind: "benchmark",
        description: "Package-defined neutral ordinary resistance benchmark",
      },
    });
    expect(input.timeToMaterialEffectMs).toBe(1000);
    expect(first.derivation).toMatchObject({
      rule: "reference-attempt-v1",
      resistanceReason: expect.stringContaining("Package-defined"),
    });
  });

  it("uses authored target resistance, not a model invented difficulty", () => {
    const result = prepare({}, (world) => {
      world.facts.push({
        id: "fact.fixtures.refrigeration-resistance",
        subjectId: locationId,
        predicate: "rules.action-resistance",
        value: 65,
        visibility: "public",
        tags: ["mechanics"],
      });
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(resolveActionInputSchema.parse(result.input).resistance).toEqual({
      kind: "fixed", value: 65,
      provenance: {
        kind: "authored",
        sourceId: "fact.fixtures.refrigeration-resistance",
        description: "Authored fixed resistance from an authoritative target fact",
      },
    });
  });

  it("uses a target's real mechanics for opposition and never invents helpers", () => {
    const result = prepare({
      declaration: "I attack the resisting opponent.",
      goal: "Attack a resisting opponent",
      targetIds: ["campaign.entity.amelia-copy"],
      modes: ["attack"],
    }, (world) => {
      const actor = world.entities.find((entity) => entity.id === playerId)!;
      world.entities.push({ ...actor, id: "campaign.entity.amelia-copy", name: "Other fighter" });
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const input = resolveActionInputSchema.parse(result.input);
    expect(input.resistance.kind).toBe("opposed");
    if (input.resistance.kind === "opposed") {
      expect(input.resistance.actorId).toBe("campaign.entity.amelia-copy");
      expect(input.resistance.performance.attributeIds).toEqual(["agility", "perception"]);
    }
    expect(input.performance.attributeIds).toEqual(["agility", "strength"]);
    expect(input.performance.applicableSkillIds).toContain("skill.fighting");
    expect(input.performance.helpers).toEqual([]);
    expect(input.stressConsequence).toEqual(expect.objectContaining({
      normallyFatal: false, pcDeathConsent: false, track: "injury",
    }));
  });

  it("requests targeted realization instead of giving unmechanized opponents invented numbers", () => {
    const result = prepare({
      declaration: "I attack Nina.",
      modes: ["attack"],
      targetIds: ["campaign.entity.nina"],
    });
    expect(result.status).toBe("missing-required-data");
    if (result.status !== "missing-required-data") return;
    expect(result.required).toContain("entity:campaign.entity.nina:mechanics");
  });

  it("does not conjure gear or unauthorized powers", () => {
    expect(prepare({
      declaration: "I pry the door with a crowbar.",
      statedMeans: ["crowbar"],
      modes: ["manipulation"],
    })).toMatchObject({ status: "cannot-attempt", reason: expect.stringContaining("crowbar") });
    expect(prepare({
      declaration: "I use my unregistered power to shove the door.",
      modes: ["power-use", "interaction"],
    })).toMatchObject({ status: "cannot-attempt", reason: expect.stringContaining("registered handler") });
  });

  it("keeps creative generic actions and clamps the material duration to remaining pressure", () => {
    const result = prepare({
      declaration: "I attempt to make an improvised signal using the surroundings.",
      goal: "Improvise a signal",
      modes: ["other"],
      targetIds: [],
      pressureLevel: 9,
      requestedHorizonMs: 28_800_000,
      authorizedHorizonMs: 5_000,
      remainingHorizonMs: 500,
    });
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const input = resolveActionInputSchema.parse(result.input);
    expect(input.timeToMaterialEffectMs).toBe(500);
    expect(input.performance.attributeIds).toEqual(["improvisation", "focus"]);
    expect(input.effect).toEqual({ mode: "fixed", potentialEffect: 1 });
  });

  it("leaves specialized operations to their registered handlers", () => {
    const result = prepareReferenceActionAttempt({
      operationId: "rules.actions.complete-routine-task",
      attempt: attempt(),
      world: immutableOperationWorldView(fixture()),
    });
    expect(result).toEqual({ status: "not-applicable" });
  });
});
