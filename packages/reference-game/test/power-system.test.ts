import { describe, expect, it } from "vitest";
import { ScriptedModelRuntime } from "@llm-ttrpg/harness";
import {
  applyPowerExperimentAdjudication,
  awakeningEarthPowerExemplars,
  awakeningEarthPowerTagVocabulary,
  copyPastePower,
  createPowerExperimentProposalModel,
  createPowerProposalModel,
  firstPowerGenerationRequest,
  powerStateSchema,
  powerTagSchema,
  quickChangePower,
  retrievePowerExemplars,
  validateGeneratedPowerProposal,
} from "@llm-ttrpg/reference-game";

const normalizedSetup = {
  establishedFacts: [{
    id: "player.fact.work",
    category: "work-school" as const,
    statement: "Rowan works in a grocery store.",
    sourceText: "works in a grocery store",
  }],
  unspecifiedAreas: ["education"],
  currentWants: ["keep their sibling safe"],
  powerPreferences: {
    positive: [{ description: "protective or movement powers", strength: "prefer" as const }],
    negative: ["mind control"],
    surpriseMe: false,
  },
  followUpQuestions: [],
};

function novelFirstPower() {
  return {
    id: "power.friction-lock",
    name: "Friction Lock",
    corePrinciple:
      "The user can temporarily prevent a touched non-living surface from changing its current coefficient of friction.",
    characterLevelAtManifestation: 1,
    manifestationStrength: 1,
    growthProfile: "hybrid" as const,
    pp: 5,
    powerLevel: 1,
    functions: [{
      id: "power-function.friction-lock.hold",
      name: "Friction Lock",
      description:
        "Hold the current friction behavior of one touched non-living surface for a short time.",
      manaCost: 4,
      activationTimeMs: 100,
      conditions: ["the user is touching the target surface at activation"],
      targets: ["one non-living surface"],
      limits: [
        "does not directly increase or decrease friction",
        "short initial duration",
        "one target at a time",
      ],
      scalingFormula: "durationSeconds=3+PowerLevel",
    }],
    developmentAxes: ["duration", "target area", "activation range"],
    tags: [
      "domain.friction",
      "operation.alter",
      "target.object",
      "shape.touch",
      "role.utility",
    ],
    balanceRationale:
      "The effect preserves one narrow physical property rather than granting general surface control.",
  };
}

describe("Awakening Earth power semantics", () => {
  it("uses open-ended many-to-many tags to retrieve relevant exemplars", () => {
    const mobility = retrievePowerExemplars({
      tags: ["role.mobility"],
      limit: 10,
    });

    expect(mobility.map((power) => power.id)).toEqual(expect.arrayContaining([
      "power.fast-travel",
      "power.combustion",
      "power.heat-rising",
      "power.quick-change",
    ]));
    expect(powerTagSchema.parse("domain.magnetism")).toBe("domain.magnetism");
    expect(awakeningEarthPowerTagVocabulary).not.toContain("domain.magnetism");
  });

  it("keeps the exemplar catalog illustrative rather than exhaustive", async () => {
    const request = firstPowerGenerationRequest({
      characterSummary:
        "Rowan works in a grocery store and is worried about their sibling.",
      normalizedSetup,
      suggestedTags: ["role.utility", "role.mobility"],
    });
    const power = novelFirstPower();
    const runtime = new ScriptedModelRuntime([{
      id: "novel-power",
      match: {
        schemaId: "awakening-earth.power-proposal.v1",
        predicate: (modelRequest) => {
          expect(modelRequest.prompt.instructions.join(" ")).toMatch(
            /illustrative and explicitly non-exhaustive/i,
          );
          expect(modelRequest.prompt.context).toContain("illustrativeExemplars");
          return true;
        },
      },
      result: {
        kind: "structured",
        value: {
          power,
          preferenceRationale:
            "It is a practical protective/utility power without violating the no-mind-control constraint.",
          negativeConstraintsRespected: true,
        },
      },
    }]);

    const proposal = await createPowerProposalModel(runtime).propose(request);

    expect(proposal.power.id).toBe("power.friction-lock");
    expect(proposal.power.tags).toContain("domain.friction");
    expect(awakeningEarthPowerExemplars.some(
      (candidate) => candidate.id === proposal.power.id,
    )).toBe(false);
  });

  it("rejects a raw stat enhancement as the player's first power", () => {
    const request = firstPowerGenerationRequest({
      characterSummary: "Rowan is physically active.",
      normalizedSetup,
    });
    const power = powerStateSchema.parse({
      ...novelFirstPower(),
      id: "power.raw-strength",
      name: "Raw Strength",
      corePrinciple: "The user's effective Strength is supernaturally increased.",
      functions: [{
        id: "power-function.raw-strength.passive",
        name: "Raw Strength",
        description: "Passively increase effective Strength.",
        manaCost: 0,
        activationTimeMs: 0,
        conditions: ["the power is manifested"],
        targets: ["self"],
        limits: ["does not rewrite the base Strength attribute"],
        scalingFormula: "strengthBonus=2*PowerLevel",
      }],
      developmentAxes: ["strength bonus"],
      tags: [
        "domain.body",
        "operation.reinforce",
        "target.self",
        "shape.passive",
        "role.enhancement",
        "role.stat-enhancement",
      ],
      balanceRationale:
        "A deliberately plain stat enhancement reserved for later powers or NPCs.",
    });

    expect(() => validateGeneratedPowerProposal(request, {
      power,
      preferenceRationale: "Simple physical enhancement.",
      negativeConstraintsRespected: true,
    })).toThrow(/raw stat-enhancement/i);
  });

  it("adjudicates a new edge behavior without changing the core power principle", async () => {
    const request = {
      power: quickChangePower,
      attemptedAction:
        "I become lighter while already in the air and see whether my jump carries farther.",
      worldContext:
        "The user is in an ordinary gym with normal Earth gravity and no other supernatural effects.",
      applicableRules: ["ordinary momentum and action-resolution rules still apply"],
    };
    const runtime = new ScriptedModelRuntime([{
      id: "quick-change-experiment",
      match: { schemaId: "awakening-earth.power-experiment.v1" },
      result: {
        kind: "structured",
        value: {
          powerId: quickChangePower.id,
          conclusion: "new-canonical-edge-behavior",
          rationale:
            "Changing mass is within the existing self-mass rule, but how momentum behaves across the change was not yet established.",
          newBehavior: {
            id: "power-behavior.quick-change.momentum-conserved",
            question: "What happens to momentum when mass changes mid-motion?",
            outcome: "valid",
            ruling:
              "Changing mass does not itself create or erase linear momentum; velocity changes as required to conserve momentum unless another force acts.",
            establishedBy: "experiment",
            evidenceEventIds: [],
          },
        },
      },
    }]);

    const ruling = await createPowerExperimentProposalModel(runtime).propose(request);
    const updated = applyPowerExperimentAdjudication(request, ruling);

    expect(updated.corePrinciple).toBe(quickChangePower.corePrinciple);
    expect(updated.discoveredBehaviors).toContainEqual(expect.objectContaining({
      id: "power-behavior.quick-change.momentum-conserved",
      outcome: "valid",
    }));
    expect(copyPastePower.discoveredBehaviors).toEqual([]);
  });
});
