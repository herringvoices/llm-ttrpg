import { describe, expect, it } from "vitest";
import {
  createOpeningProgressionState,
  ensureOpeningCreature,
  openingSituationSchema,
} from "@llm-ttrpg/reference-game";
import { startingRegionStageOutputs } from "./starting-region-fixture.js";

describe("Awakening Earth opening progression", () => {
  it("keeps legacy opening briefs on the creature path with a three-turn deadline", () => {
    const opening = openingSituationSchema.parse({
      ordinaryAnchorEntityIds: ["generated.location.grocery"],
      awakeningEvent: "Something supernatural happens.",
      manifestationOpportunity: "The player has an opportunity to awaken.",
      combatRequired: false,
      unresolvedConsequences: ["the situation remains unresolved"],
      actionableDirections: {
        social: ["talk to someone"],
        investigative: ["look closer"],
        risky: ["intervene"],
      },
      mandatoryQuest: false,
    });
    expect(opening).toEqual(expect.objectContaining({
      openingMode: "supernatural-inciting-incident",
      supernaturalFocus: "creature",
      manifestationTargetTurn: 3,
      manifestationDeadlineTurns: 3,
    }));
  });

  it("does not manufacture a near-term creature for mundane or phenomenon openings", () => {
    const outputs = startingRegionStageOutputs();
    const baseSeed = {
      normalized: outputs.normalize,
      region: outputs.region,
      settlement: outputs.settlement,
      institutions: outputs.institutions,
      locality: outputs.locality,
      playerContext: outputs["player-context"],
      npcs: outputs.npcs,
      pressures: outputs.pressures.pressures,
      creatures: [],
      knowledge: outputs.pressures.knowledge,
      processes: outputs.pressures.processes,
      openingSituation: {
        ...outputs["opening-situation"],
        openingMode: "mundane-manifestation" as const,
        supernaturalFocus: "none" as const,
      },
    };
    const mundane = ensureOpeningCreature(baseSeed);
    expect(mundane.creatures).toEqual([]);

    const phenomenon = ensureOpeningCreature({
      ...baseSeed,
      openingSituation: {
        ...baseSeed.openingSituation,
        openingMode: "supernatural-inciting-incident" as const,
        supernaturalFocus: "phenomenon" as const,
      },
    });
    expect(phenomenon.creatures).toEqual([]);
  });

  it("creates hidden runtime opening state without awakening the player early", () => {
    const outputs = startingRegionStageOutputs();
    const opening = openingSituationSchema.parse({
      ...outputs["opening-situation"],
      openingMode: "mundane-manifestation",
      supernaturalFocus: "none",
      manifestationTargetTurn: 1,
    });
    const state = createOpeningProgressionState(opening, {
      characterSummary:
        "Rowan works at a grocery store, rents an apartment, and wants to protect their sibling.",
      normalizedSetup: outputs.normalize.player,
    });
    expect(state).toEqual(expect.objectContaining({
      openingMode: "mundane-manifestation",
      supernaturalFocus: "none",
      playerTurnsSinceStart: 0,
      manifestationTargetTurn: 1,
      manifestationDeadlineTurns: 3,
      firstPowerManifested: false,
      manifestationNarrationPending: false,
    }));
    expect(state.firstPowerProposal).toBeUndefined();
  });
});
