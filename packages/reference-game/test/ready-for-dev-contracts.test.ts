import {
  actorSocialStateSchema,
  assertNoRetconJsonExtension,
  fictionalInstant,
} from "@llm-ttrpg/engine";
import {
  ATTRIBUTE_IDS,
  calculatePerformance,
  createDefaultMundaneProgression,
  performancePlanSchema,
  rulesCreatureStateSchema,
  validateStartingHumanProposal,
  type RulesActorState,
} from "@llm-ttrpg/reference-game";
import { describe, expect, it } from "vitest";

function attributes(value = 54): RulesActorState["attributes"] {
  return Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, value])) as
    RulesActorState["attributes"];
}

describe("ready-for-dev world and realization contracts", () => {
  it("keeps relationships directional and schedule-like commitments explicit", () => {
    const state = actorSocialStateSchema.parse({
      actorId: "campaign.entity.alice",
      goals: [],
      relationships: [{
        id: "relationship.alice-bob",
        targetEntityId: "campaign.entity.bob",
        dimensions: { trust: 0.75, resentment: -0.1 },
        salience: 0.8,
        tags: ["friend"],
        lastUpdatedAt: fictionalInstant("2040-01-01T12:00:00.000Z"),
      }],
      memories: [],
      commitments: [{
        id: "commitment.alice-shift",
        label: "Work the afternoon shift",
        start: fictionalInstant("2040-01-02T13:00:00.000Z"),
        end: fictionalInstant("2040-01-02T21:00:00.000Z"),
        availabilityImpact: "occupied",
        relatedEntityIds: ["campaign.location.store"],
        tags: ["work"],
      }],
    });

    expect(state.relationships[0]?.targetEntityId).toBe("campaign.entity.bob");
    expect(state.commitments[0]?.availabilityImpact).toBe("occupied");
  });

  it("accepts an evidence-grounded mundane Level-0 player in the calibration bands", () => {
    const mechanics = {
      attributes: attributes(),
      skills: [{
        id: "skill.customer-service",
        name: "Customer Service",
        description: "Routine experience helping customers.",
        specificity: 2 as const,
        sp: 50,
      }],
      stress: {
        injury: 0,
        fear: 0,
        anger: 0,
        exhaustion: 0,
        insecurity: 0,
      },
      statuses: [],
      progression: createDefaultMundaneProgression(),
      isPlayerCharacter: true,
    };

    const proposal = validateStartingHumanProposal({
      mechanics,
      attributeEvidence: ATTRIBUTE_IDS.map((attributeId) => ({
        attributeId,
        direction: "near-baseline",
        rationale: "No strong biographical evidence moves this trait away from baseline.",
        sourceFactIds: [],
      })),
      skillEvidence: [{
        skillId: "skill.customer-service",
        rationale: "The biography establishes sustained retail work.",
        sourceFactIds: ["player.fact.work"],
      }],
    });

    expect(proposal.mechanics.progression.characterLevel).toBe(0);
    expect(proposal.mechanics.progression.powers).toEqual([]);
    expect(Object.values(proposal.mechanics.attributes).reduce((a, b) => a + b, 0))
      .toBe(972);
  });

  it("lets creatures use the shared performance mechanics without human progression", () => {
    const creature = rulesCreatureStateSchema.parse({
      attributes: attributes(60),
      skills: [],
      stress: {
        injury: 0,
        fear: 0,
        anger: 0,
        exhaustion: 0,
        insecurity: 0,
      },
      statuses: [],
      isPlayerCharacter: false,
    });
    const plan = performancePlanSchema.parse({
      attributeIds: ["strength"],
      applicableSkillIds: [],
      attributeModifiers: [],
      performanceModifiers: [],
      helpers: [],
      maxUsefulHelpers: 0,
      combinedAttributeContributions: [],
    });

    expect("progression" in creature).toBe(false);
    expect(calculatePerformance(creature, plan).deterministicPerformance).toBe(60);
  });

  it("permits densification but rejects retcons of established mechanical truth", () => {
    expect(() => assertNoRetconJsonExtension(
      { attributes: { strength: 50 } },
      { attributes: { strength: 50, agility: 45 }, stress: { injury: 0 } },
    )).not.toThrow();

    expect(() => assertNoRetconJsonExtension(
      { attributes: { strength: 50 } },
      { attributes: { strength: 55 } },
    )).toThrow(/retcon/i);
  });
});
