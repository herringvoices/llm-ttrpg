import {
  ATTRIBUTE_IDS,
  ATTRIBUTE_LABELS,
  minimumSpForSkillLevel,
  rulesActorStateSchema,
  skillLevelFromSp,
  skillRank,
} from "@llm-ttrpg/reference-game";

/** A read-only, player-only projection. Never use narration or model output as sheet authority. */
export interface CharacterSheetView {
  readonly level: number;
  readonly xp?: number;
  readonly xpToNextLevel?: number;
  readonly mana?: { readonly current: number; readonly max: number };
  readonly attributeGroups: readonly {
    readonly name: string;
    readonly attributes: readonly { readonly name: string; readonly value: number }[];
  }[];
  readonly skills: readonly {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly level: number;
    readonly rank: string;
    readonly sp: number;
    readonly spToNext: number;
  }[];
  readonly powers: readonly {
    readonly id: string;
    readonly name: string;
    readonly corePrinciple: string;
    readonly level: number;
    readonly pp: number;
    readonly functions: readonly {
      readonly id: string;
      readonly name: string;
      readonly description: string;
      readonly manaCost: number;
      readonly activationTimeMs: number;
      readonly conditions: readonly string[];
      readonly targets: readonly string[];
      readonly limits: readonly string[];
    }[];
    readonly discoveries: readonly {
      readonly question: string;
      readonly outcome: "valid" | "invalid" | "conditional";
      readonly ruling: string;
    }[];
  }[];
  readonly stress: readonly { readonly name: string; readonly value: number }[];
  readonly statuses: readonly { readonly id: string; readonly name: string; readonly description: string }[];
}

export function projectCharacterSheet(rawMechanics: unknown): CharacterSheetView | undefined {
  const result = rulesActorStateSchema.safeParse(rawMechanics);
  if (!result.success || !result.data.isPlayerCharacter) return undefined;
  const state = result.data;
  const progression = state.progression;
  const groupSpecs = [
    { name: "Physical", ids: ATTRIBUTE_IDS.slice(0, 6) },
    { name: "Mental", ids: ATTRIBUTE_IDS.slice(6, 12) },
    { name: "Social", ids: ATTRIBUTE_IDS.slice(12, 18) },
  ];
  return {
    level: progression.characterLevel,
    ...(progression.characterXp === undefined ? {} : {
      xp: progression.characterXp,
      xpToNextLevel: Math.max(0,
        Math.ceil((5 * (progression.characterLevel + 1) ** 3) / 4) - progression.characterXp),
    }),
    ...(progression.mana ? { mana: { ...progression.mana } } : {}),
    attributeGroups: groupSpecs.map((group) => ({
      name: group.name,
      attributes: group.ids.map((id) => ({
        name: ATTRIBUTE_LABELS[id],
        // The parsed schema requires every ATTRIBUTE_ID; TS cannot infer its refinement.
        value: state.attributes[id]!,
      })),
    })),
    skills: state.skills.map((skill) => {
      const level = skillLevelFromSp(skill.sp);
      return {
        id: skill.id,
        name: skill.name,
        description: skill.description,
        level,
        rank: skillRank(level),
        sp: skill.sp,
        spToNext: Math.max(0, minimumSpForSkillLevel(level + 1) - skill.sp),
      };
    }).sort((a, b) => b.level - a.level || a.name.localeCompare(b.name)),
    powers: (progression.powers ?? []).map((power) => ({
      id: power.id,
      name: power.name,
      corePrinciple: power.corePrinciple,
      level: power.powerLevel,
      pp: power.pp,
      functions: power.functions.map((fn) => ({
        id: fn.id,
        name: fn.name,
        description: fn.description,
        manaCost: fn.manaCost,
        activationTimeMs: fn.activationTimeMs,
        conditions: [...fn.conditions],
        targets: [...fn.targets],
        limits: [...fn.limits],
      })),
      discoveries: power.discoveredBehaviors.map((behavior) => ({
        question: behavior.question,
        outcome: behavior.outcome,
        ruling: behavior.ruling,
      })),
    })),
    stress: Object.entries(state.stress).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
    })),
    statuses: state.statuses.map(({ id, name, description }) => ({ id, name, description })),
  };
}
