import { describe, expect, it } from "vitest";
import { quickChangePower } from "@llm-ttrpg/reference-game";
import { projectCharacterSheet } from "../apps/desktop/src/character-sheet.js";
import { startingRegionStageOutputs } from "../packages/reference-game/test/starting-region-fixture.js";

describe("player character sheet projection", () => {
  const mundane = startingRegionStageOutputs()["player-context"].mechanics.mechanics;

  it("shows complete mundane attributes and skills before awakening", () => {
    const sheet = projectCharacterSheet(mundane);
    expect(sheet?.level).toBe(0);
    expect(sheet?.xp).toBe(0);
    expect(sheet?.attributeGroups.map((group) => group.attributes.length)).toEqual([6, 6, 6]);
    expect(sheet?.skills[0]?.name).toBe("Customer Service");
    expect(sheet?.skills[0]?.level).toBeGreaterThan(0);
    expect(sheet?.powers).toEqual([]);
    expect(sheet?.mana).toBeUndefined();
  });

  it("shows only manifested power functions and already recorded discoveries", () => {
    const awakened = {
      ...mundane,
      progression: {
        ...mundane.progression,
        characterLevel: 1,
        characterXp: 2,
        mana: { current: 8, max: 15 },
        powers: [quickChangePower],
      },
    };
    const sheet = projectCharacterSheet(awakened);
    expect(sheet?.level).toBe(1);
    expect(sheet?.xpToNextLevel).toBe(8);
    expect(sheet?.mana).toEqual({ current: 8, max: 15 });
    expect(sheet?.powers[0]?.name).toBe(quickChangePower.name);
    expect(sheet?.powers[0]?.functions.length).toBe(quickChangePower.functions.length);
    expect(JSON.stringify(sheet)).not.toContain("balanceRationale");
    expect(JSON.stringify(sheet)).not.toContain("developmentAxes");
  });

  it("does not expose malformed or non-player mechanics", () => {
    expect(projectCharacterSheet({})).toBeUndefined();
    expect(projectCharacterSheet({ ...mundane, isPlayerCharacter: false })).toBeUndefined();
  });
});
