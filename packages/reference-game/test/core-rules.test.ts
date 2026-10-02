import {
  assessResolutionOperation,
  createGameRuntime,
  createInMemoryPersistence,
  executeRulesOperation,
  fictionalDurationMs,
  initializeCampaignWorld,
  loadGameDefinition,
  resolveUncertainOperation,
  type DeterministicRandom,
  type ExecutableIntent,
  type GameDefinition,
  type LoadedGameDefinition,
} from "@llm-ttrpg/engine";
import {
  ATTRIBUTE_IDS,
  benchmarkFixedResistance,
  calculatePerformance,
  checkedEffectThresholds,
  checkedRealizedEffect,
  classifyFixedResistance,
  classifyOpposedResistance,
  createEmergentSkillInputSchema,
  extendedTaskSchema,
  materialEffectSchema,
  minimumSpForSkillLevel,
  performancePlanSchema,
  recoverStressInputSchema,
  referenceGameDefinition,
  repeatAttemptSchema,
  resolveActionInputSchema,
  rollPerformanceVariance,
  rulesActorStateSchema,
  skillLevelFromSp,
  skillRank,
  stressPenaltyPercent,
  type PerformancePlan,
  type ResolveActionInput,
  type ResolveActionResult,
  type RulesActorState,
} from "@llm-ttrpg/reference-game";
import { describe, expect, it } from "vitest";

const actionOperationId = "rules.actions.resolve-action";

function allAttributes(value = 50): RulesActorState["attributes"] {
  return Object.fromEntries(ATTRIBUTE_IDS.map((id) => [id, value])) as
    RulesActorState["attributes"];
}

function actorState(
  overrides: Partial<RulesActorState> = {},
): RulesActorState {
  return rulesActorStateSchema.parse({
    attributes: allAttributes(),
    skills: [],
    stress: {
      injury: 0,
      fear: 0,
      anger: 0,
      exhaustion: 0,
      insecurity: 0,
    },
    statuses: [],
    progression: {
      characterLevel: 1,
      skillPointsPerCharacterLevel: 5,
      skillLearningRateMultiplier: 1,
      skillUseEvidence: [],
    },
    isPlayerCharacter: false,
    ...overrides,
  });
}

const knowledgeSkills: RulesActorState["skills"] = [
  {
    id: "skill.science",
    name: "Knowledge (Science)",
    description: "Broad scientific literacy.",
    specificity: 1,
    sp: minimumSpForSkillLevel(8),
  },
  {
    id: "skill.life-science",
    name: "Knowledge (Life Science)",
    description: "Study of living systems.",
    specificity: 2,
    sp: minimumSpForSkillLevel(6),
  },
  {
    id: "skill.biology",
    name: "Knowledge (Biology)",
    description: "Focused biological analysis.",
    specificity: 3,
    sp: minimumSpForSkillLevel(5),
  },
  {
    id: "skill.entomology",
    name: "Knowledge (Entomology)",
    description: "Specialized study of insects.",
    specificity: 4,
    sp: minimumSpForSkillLevel(4),
  },
];

const versatileSkills: RulesActorState["skills"] = [
  {
    id: "skill.lockpicking",
    name: "Lockpicking",
    description: "Focused manipulation of mechanical locks.",
    specificity: 3,
    sp: minimumSpForSkillLevel(2),
  },
  {
    id: "skill.charm",
    name: "Charm",
    description: "Social warmth, rapport, and favorable first impressions.",
    specificity: 2,
    sp: minimumSpForSkillLevel(4),
  },
  {
    id: "skill.athletics",
    name: "Athletics",
    description: "Broad trained movement and exertion.",
    specificity: 1,
    sp: minimumSpForSkillLevel(5),
  },
  {
    id: "skill.striking",
    name: "Striking",
    description: "Focused ability to land and deliver physical strikes.",
    specificity: 3,
    sp: minimumSpForSkillLevel(4),
  },
];

function gameWithActors(
  amelia = actorState({ skills: versatileSkills }),
  rival = actorState({ skills: versatileSkills }),
  player = actorState({ isPlayerCharacter: true }),
): LoadedGameDefinition {
  const entities = referenceGameDefinition.campaign.content.entities.map(
    (entity) => entity.id === "campaign.entity.amelia"
      ? { ...entity, data: { ...entity.data, mechanics: amelia } }
      : entity,
  );
  const definition: GameDefinition = {
    ...referenceGameDefinition,
    campaign: {
      ...referenceGameDefinition.campaign,
      content: {
        ...referenceGameDefinition.campaign.content,
        entities: [
          ...entities,
          {
            id: "campaign.entity.rival",
            kind: "actor",
            name: "Rival",
            summary: "A mechanically complete opposed-action fixture.",
            data: { mechanics: rival },
          },
          {
            id: "campaign.entity.player",
            kind: "actor",
            name: "Player Character",
            summary: "A mechanically complete player-character fixture.",
            data: { mechanics: player },
          },
          {
            id: "campaign.entity.helper",
            kind: "actor",
            name: "Helper",
            summary: "A mechanically complete cooperation fixture.",
            data: { mechanics: actorState() },
          },
        ],
      },
    },
  };
  return loadGameDefinition(definition);
}

function basePlan(
  overrides: Partial<PerformancePlan> = {},
): PerformancePlan {
  return performancePlanSchema.parse({
    attributeIds: ["agility"],
    applicableSkillIds: [],
    attributeModifiers: [],
    performanceModifiers: [],
    helpers: [],
    maxUsefulHelpers: 0,
    combinedAttributeContributions: [],
    ...overrides,
  });
}

function actionInput(
  id: string,
  overrides: Partial<ResolveActionInput> = {},
): ResolveActionInput {
  return resolveActionInputSchema.parse({
    declaredActionId: id,
    actorId: "campaign.entity.amelia",
    approach: "perform the declared action",
    feasibility: { status: "feasible" },
    performance: basePlan(),
    resistance: {
      kind: "fixed",
      value: 50,
      provenance: {
        kind: "authored",
        description: "Acceptance-test fixed Resistance.",
      },
    },
    effect: { mode: "fixed", potentialEffect: 1 },
    timeToMaterialEffectMs: 1_000,
    scopeIds: ["scope.reference-scene"],
    ...overrides,
  });
}

function intent(
  actorId = "campaign.entity.amelia",
  pressureLevel: ExecutableIntent["pressureLevel"] = 6,
): ExecutableIntent {
  const horizon = pressureLevel === 9 ? 5_000 : 60_000;
  return {
    actorId,
    goal: "resolve the acceptance example",
    targetIds: [],
    pressureLevel,
    requestedHorizonMs: fictionalDurationMs(horizon),
    authorizedHorizonMs: fictionalDurationMs(horizon),
    wasNarrowed: false,
  };
}

function sequenceRandom(...values: number[]): DeterministicRandom {
  let index = 0;
  return {
    next() {
      const value = values[index++];
      if (value === undefined) throw new Error("RNG fixture exhausted");
      return value;
    },
  };
}

function assess(game: LoadedGameDefinition, input: ResolveActionInput) {
  return assessResolutionOperation<
    ResolveActionInput,
    ResolveActionInput,
    ResolveActionResult
  >(
    game.operationRegistry,
    actionOperationId,
    initializeCampaignWorld(game, 0x1234_5678),
    intent(input.actorId),
    input,
  );
}

function runtime(game: LoadedGameDefinition, seed = 0x1234_5678) {
  let id = 0;
  return createGameRuntime({
    persistence: createInMemoryPersistence(),
    game,
    wallClock: { now: () => "2044-01-01T00:00:00.000Z" },
    idGenerator: {
      next(kind) {
        id += 1;
        return `${kind}.core-rules-${id}`;
      },
    },
    worldSeedSource: { nextSeed: () => seed },
  });
}

describe("reference rules formulas", () => {
  it("defines all attributes and exact skill-level/rank thresholds", () => {
    expect(ATTRIBUTE_IDS).toHaveLength(18);
    expect(ATTRIBUTE_IDS).toEqual(expect.arrayContaining([
      "presence",
      "cool",
      "social-fluency",
      "fine-motor-skills",
      "critical-thinking",
    ]));
    const expectedThresholds = [0, 2, 10, 34, 80, 157, 270, 429, 640, 912, 1250];
    expect(expectedThresholds.map(skillLevelFromSp)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
    ]);
    expect(skillLevelFromSp(1.75)).toBe(0);
    expect(skillLevelFromSp(9.75)).toBe(1);
    expect([0, 1, 3, 5, 8, 10].map(skillRank)).toEqual([
      "Untrained",
      "Novice",
      "Apprentice",
      "Journeyman",
      "Expert",
      "Master",
    ]);
  });

  it("preserves precision, averages attributes, selects one strongest skill, and applies component modifiers", () => {
    const state = actorState({
      attributes: {
        ...allAttributes(),
        agility: 40,
        perception: 60,
      },
      skills: knowledgeSkills,
    });
    const untrained = calculatePerformance(state, basePlan({
      attributeIds: ["agility", "perception"],
      attributeModifiers: [
        {
          id: "circumstance.darkness",
          description: "Darkness reduces visual Perception.",
          attributeId: "perception",
          percent: -10,
        },
      ],
      performanceModifiers: [
        {
          id: "equipment.precise-tools",
          description: "Precise tools improve overall Performance.",
          percent: 5,
        },
      ],
    }));
    expect(untrained.attributeBasis).toBe(47);
    expect(untrained.deterministicPerformance).toBe(49.35);

    const knowledge = calculatePerformance(state, basePlan({
      attributeIds: ["critical-thinking", "memory"],
      applicableSkillIds: knowledgeSkills.map((skill) => skill.id),
    }));
    expect(knowledge.selectedSkillId).toBe("skill.entomology");
    expect(knowledge.applicableSkills).toHaveLength(4);
    expect(knowledge.trainedCapability).toBe(90);
  });

  it("handles assistance, literal combined capability, stress stacking, and semantic helper limits", () => {
    const state = actorState();
    const helped = calculatePerformance(state, basePlan({
      helpers: [
        {
          actorId: "campaign.entity.helper",
          contribution: "Keeps the mechanism aligned.",
        },
      ],
      maxUsefulHelpers: 1,
    }));
    expect(helped.assistancePercent).toBe(5);
    expect(helped.deterministicPerformance).toBe(52.5);

    const combined = calculatePerformance(
      state,
      basePlan({
        attributeIds: ["strength"],
        combinedAttributeContributions: [
          {
            actorId: "campaign.entity.helper",
            attributeId: "strength",
            justification: "Both actors directly bear the load.",
          },
        ],
      }),
      new Map([["campaign.entity.helper", actorState()]]),
    );
    expect(combined.attributeBasis).toBe(100);

    const stressed = actorState({
      stress: {
        injury: 5,
        fear: 5,
        anger: 5,
        exhaustion: 5,
        insecurity: 5,
      },
    });
    expect(stressPenaltyPercent(stressed)).toBe(70);
    expect(calculatePerformance(stressed, basePlan()).deterministicPerformance)
      .toBeCloseTo(15);
    expect(() => performancePlanSchema.parse({
      ...basePlan(),
      helpers: [
        { actorId: "campaign.entity.a", contribution: "Useful A" },
        { actorId: "campaign.entity.b", contribution: "Useful B" },
      ],
      maxUsefulHelpers: 1,
    })).toThrow(/useful limit/i);
    expect(() => performancePlanSchema.parse({
      ...basePlan(),
      performanceModifiers: [
        {
          id: "circumstance.first-extreme",
          description: "One extreme circumstance.",
          percent: 40,
        },
        {
          id: "circumstance.second-extreme",
          description: "A second stacked extreme circumstance.",
          percent: 40,
        },
      ],
    })).toThrow(/exceed the Extreme band/i);
  });

  it("classifies ranges before RNG and uses centered triangular d16 variance", () => {
    const calculation = calculatePerformance(actorState(), basePlan());
    expect(classifyFixedResistance(calculation, 40)).toBe("automatic");
    expect(classifyFixedResistance(calculation, 50)).toBe("uncertain");
    expect(classifyFixedResistance(calculation, 60)).toBe("impossible");
    expect(classifyOpposedResistance(calculation, calculation)).toBe(
      "uncertain",
    );
    expect(rollPerformanceVariance(100, sequenceRandom(0, 0))).toEqual({
      dice: [1, 1],
      variancePercent: -15,
      finalPerformance: 85,
    });
    expect(
      rollPerformanceVariance(100, sequenceRandom(0.999, 0.999)),
    ).toEqual({
      dice: [16, 16],
      variancePercent: 15,
      finalPerformance: 114.99999999999999,
    });
  });

  it("calibrates fixed Resistance from a benchmark and centralizes checked Effect thresholds", () => {
    const benchmark = benchmarkFixedResistance(
      actorState({ skills: [versatileSkills[0]!] }),
      basePlan({
        attributeIds: ["perception", "fine-motor-skills"],
        applicableSkillIds: ["skill.lockpicking"],
      }),
      "Ordinary human novice lockpicker benchmark.",
    );
    expect(benchmark.provenance).toEqual({
      kind: "benchmark",
      description: "Ordinary human novice lockpicker benchmark.",
    });
    expect(benchmark.value).toBe(65);
    expect(checkedEffectThresholds(100)).toEqual({
      effect1: 100,
      effect2: 114.99999999999999,
      effect3: 130,
    });
    expect(checkedRealizedEffect(130, 100, 2)).toBe(2);
    expect(checkedRealizedEffect(100, 100, 3)).toBe(0);
  });
});

describe("unified action resolution", () => {
  it("resolves mundane automatic and impossible actions without consuming RNG", async () => {
    const game = gameWithActors();
    const session = await runtime(game).createWorld("Automatic and impossible");
    const automatic = await session.resolve<ResolveActionResult>({
      intent: intent("campaign.entity.amelia", 1),
      operation: {
        id: actionOperationId,
        input: actionInput("action.mundane", {
          resistance: {
            kind: "fixed",
            value: 10,
            provenance: {
              kind: "direct",
              description: "A trivial unopposed physical requirement.",
            },
          },
        }),
      },
    });
    expect(automatic.path).toBe("automatic");
    expect(automatic.randomness).toBeNull();
    expect(automatic.result).toEqual(expect.objectContaining({
      success: true,
      realizedEffect: 1,
    }));
    const impossible = await session.resolve<ResolveActionResult>({
      intent: intent(),
      operation: {
        id: actionOperationId,
        input: actionInput("action.impossible", {
          resistance: {
            kind: "fixed",
            value: 100,
            provenance: {
              kind: "direct",
              description: "A requirement beyond the plausible variance range.",
            },
          },
        }),
      },
    });
    expect(impossible.path).toBe("impossible");
    expect(impossible.randomness).toBeNull();
    expect(impossible.result.realizedEffect).toBe(0);
    const fictionallyImpossible = await session.resolve<ResolveActionResult>({
      intent: intent(),
      operation: {
        id: actionOperationId,
        input: actionInput("action.hard-impossible", {
          feasibility: {
            status: "impossible",
            reason: "The declared method cannot affect an incorporeal target.",
          },
          resistance: {
            kind: "fixed",
            value: 1,
            provenance: {
              kind: "direct",
              description: "Numeric capability is irrelevant to feasibility.",
            },
          },
        }),
      },
    });
    expect(fictionallyImpossible.path).toBe("impossible");
    expect(fictionallyImpossible.randomness).toBeNull();
    expect(session.snapshot().randomness.nextStream).toBe(0);
  });

  it("resolves a fixed lock obstacle with provenance, triangular RNG, and fractional SP persisted", async () => {
    const game = gameWithActors();
    const session = await runtime(game, 0x2468_ace0).createWorld("Lock check");
    const input = actionInput("action.pick-lock", {
      approach: "feel and manipulate the lock pins",
      performance: basePlan({
        attributeIds: ["perception", "fine-motor-skills"],
        applicableSkillIds: ["skill.lockpicking"],
      }),
      resistance: {
        kind: "fixed",
        value: 65,
        provenance: {
          kind: "benchmark",
          description: "Human-scale residential lock; novice benchmark.",
        },
      },
      effect: { mode: "fixed", potentialEffect: 1 },
    });
    const result = await session.resolve<ResolveActionResult>({
      intent: intent(),
      operation: { id: actionOperationId, input },
    });
    expect(result.path).toBe("uncertain");
    expect(result.randomness?.draws).toBe(2);
    expect(result.basis).toEqual(expect.objectContaining({
      actionClassification: "uncertain",
      resistance: expect.objectContaining({
        kind: "fixed",
        provenance: expect.objectContaining({ kind: "benchmark" }),
      }),
      actorPerformance: expect.objectContaining({
        selectedSkillId: "skill.lockpicking",
      }),
    }));
    expect(result.result.skillSpAwards).toEqual([
      expect.objectContaining({
        skillId: "skill.lockpicking",
        amount: result.result.success ? 0.5 : 0.25,
      }),
    ]);
    const mechanics = rulesActorStateSchema.parse(
      session.snapshot().entities.find(
        (entity) => entity.id === "campaign.entity.amelia",
      )!.data.mechanics,
    );
    expect(mechanics.skills.find((skill) => skill.id === "skill.lockpicking")!.sp)
      .toBe(10 + (result.result.success ? 0.5 : 0.25));
  });

  it("uses the same opposed rules for knowledge, social action, a race, and high-pressure timing", () => {
    const knowledgeActor = actorState({ skills: knowledgeSkills });
    const knowledge = calculatePerformance(knowledgeActor, basePlan({
      attributeIds: ["critical-thinking", "memory"],
      applicableSkillIds: knowledgeSkills.map((skill) => skill.id),
    }));
    expect(knowledge.selectedSkillId).toBe("skill.entomology");

    const game = gameWithActors();
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const social = actionInput("action.social-charm", {
      approach: "build rapport through warmth and empathy",
      performance: basePlan({
        attributeIds: ["presence", "empathy"],
        applicableSkillIds: ["skill.charm"],
      }),
      resistance: {
        kind: "opposed",
        actorId: "campaign.entity.rival",
        performance: basePlan({
          attributeIds: ["cool", "self-awareness"],
          applicableSkillIds: ["skill.charm"],
        }),
      },
      effect: { mode: "fixed", potentialEffect: 2 },
      stressConsequence: {
        targetId: "campaign.entity.rival",
        track: "fear",
        normallyFatal: false,
        pcDeathConsent: false,
      },
    });
    const socialAssessment = assessResolutionOperation<
      ResolveActionInput,
      ResolveActionInput,
      ResolveActionResult
    >(game.operationRegistry, actionOperationId, world, intent(), social);
    expect(socialAssessment.path).toBe("uncertain");
    if (socialAssessment.path !== "uncertain") throw new Error("Expected uncertainty");
    const socialOutcome = resolveUncertainOperation<
      ResolveActionInput,
      ResolveActionResult
    >(
      game.operationRegistry,
      actionOperationId,
      world,
      socialAssessment.prepared,
      sequenceRandom(0.999, 0.999, 0, 0),
    );
    expect(socialOutcome.result).toEqual(expect.objectContaining({
      success: true,
      realizedEffect: 2,
    }));
    expect(socialOutcome.result.stressChanges).toEqual([
      {
        actorId: "campaign.entity.rival",
        track: "fear",
        before: 0,
        after: 2,
      },
    ]);

    const race = resolveActionInputSchema.parse({
      ...social,
      declaredActionId: "action.race",
      approach: "win a foot race",
      performance: basePlan({
        attributeIds: ["agility", "endurance"],
        applicableSkillIds: ["skill.athletics"],
      }),
      resistance: {
        kind: "opposed",
        actorId: "campaign.entity.rival",
        performance: basePlan({
          attributeIds: ["agility", "endurance"],
          applicableSkillIds: ["skill.athletics"],
        }),
      },
      timeToMaterialEffectMs: 5_000,
    });
    const timingAssessment = assessResolutionOperation(
      game.operationRegistry,
      actionOperationId,
      world,
      intent("campaign.entity.amelia", 9),
      race,
    );
    expect(timingAssessment.path).toBe("uncertain");
    expect(JSON.stringify(timingAssessment)).not.toMatch(/initiative|combat/i);
  });

  it("keeps rumor scope contextual and failure Effect at zero", () => {
    const game = gameWithActors();
    for (const potentialEffect of [1, 2, 3] as const) {
      const assessment = assess(game, actionInput(`action.rumor-${potentialEffect}`, {
        approach: "spread a rumor through the established audience and medium",
        resistance: {
          kind: "fixed",
          value: 1,
          provenance: {
            kind: "authored",
            description: "The prepared audience is already receptive.",
          },
        },
        effect: { mode: "fixed", potentialEffect },
      }));
      expect(assessment.path).toBe("automatic");
      if (assessment.path !== "automatic") throw new Error("Expected automatic");
      expect(assessment.outcome.result.realizedEffect).toBe(potentialEffect);
      expect(assessment.outcome.result.stressChanges).toEqual([]);
    }

    const derived = assess(game, actionInput("action.derived-effect", {
      resistance: {
        kind: "fixed",
        value: 1,
        provenance: {
          kind: "direct",
          description: "The delivery succeeds automatically.",
        },
      },
      effect: {
        mode: "derived",
        potentialEffect: 3,
        derivedEffect: 2,
        basis: "The established medium reaches a community-sized audience.",
      },
    }));
    if (derived.path !== "automatic") throw new Error("Expected automatic");
    expect(derived.outcome.result.realizedEffect).toBe(2);

    const failure = assess(game, actionInput("action.rumor-failure", {
      resistance: {
        kind: "fixed",
        value: 1_000,
        provenance: {
          kind: "authored",
          description: "No viable channel reaches the audience.",
        },
      },
      effect: { mode: "fixed", potentialEffect: 3 },
    }));
    expect(failure.path).toBe("impossible");
    if (failure.path !== "impossible") throw new Error("Expected impossible");
    expect(failure.outcome.result.realizedEffect).toBe(0);
  });

  it("separates a successful strike from independently checked impact and de-duplicates SP", () => {
    const game = gameWithActors();
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const strikingPlan = basePlan({
      attributeIds: ["agility", "perception"],
      applicableSkillIds: ["skill.striking"],
    });
    const input = actionInput("action.checked-strike", {
      approach: "land a controlled strike",
      performance: strikingPlan,
      resistance: {
        kind: "fixed",
        value: 80,
        provenance: {
          kind: "benchmark",
          description: "Defender's active avoidance benchmark.",
        },
      },
      effect: {
        mode: "checked",
        potentialEffect: 2,
        performance: strikingPlan,
        baseResistance: 80,
        provenance: {
          kind: "benchmark",
          description: "Defender Durability and protection benchmark.",
        },
      },
      stressConsequence: {
        targetId: "campaign.entity.rival",
        track: "injury",
        normallyFatal: false,
        pcDeathConsent: false,
      },
    });
    const assessment = assessResolutionOperation<
      ResolveActionInput,
      ResolveActionInput,
      ResolveActionResult
    >(game.operationRegistry, actionOperationId, world, intent(), input);
    expect(assessment.path).toBe("uncertain");
    if (assessment.path !== "uncertain") throw new Error("Expected uncertainty");
    const outcome = resolveUncertainOperation<
      ResolveActionInput,
      ResolveActionResult
    >(
      game.operationRegistry,
      actionOperationId,
      world,
      assessment.prepared,
      sequenceRandom(0.999, 0.999, 0, 0),
    );
    expect(outcome.result.success).toBe(true);
    expect(outcome.result.realizedEffect).toBe(0);
    expect(outcome.result.stressChanges).toEqual([]);
    expect(outcome.result.skillSpAwards.filter(
      (award) => award.skillId === "skill.striking",
    )).toHaveLength(1);
  });

  it("awards failure SP from Potential Effect with no margin multiplier", () => {
    const accelerated = actorState({
      skills: versatileSkills,
      progression: {
        characterLevel: 1,
        skillPointsPerCharacterLevel: 5,
        skillLearningRateMultiplier: 2,
        skillUseEvidence: [],
      },
    });
    const game = gameWithActors(accelerated);
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const input = actionInput("action.learning-failure", {
      performance: basePlan({
        attributeIds: ["perception", "fine-motor-skills"],
        applicableSkillIds: ["skill.lockpicking"],
      }),
      resistance: {
        kind: "fixed",
        value: 65,
        provenance: {
          kind: "authored",
          description: "Uncertain lock fixture.",
        },
      },
      effect: { mode: "fixed", potentialEffect: 3 },
    });
    const assessment = assessResolutionOperation<
      ResolveActionInput,
      ResolveActionInput,
      ResolveActionResult
    >(game.operationRegistry, actionOperationId, world, intent(), input);
    expect(assessment.path).toBe("uncertain");
    if (assessment.path !== "uncertain") throw new Error("Expected uncertainty");
    const outcome = resolveUncertainOperation<
      ResolveActionInput,
      ResolveActionResult
    >(
      game.operationRegistry,
      actionOperationId,
      world,
      assessment.prepared,
      sequenceRandom(0, 0),
    );
    expect(outcome.result.success).toBe(false);
    expect(outcome.result.realizedEffect).toBe(0);
    expect(outcome.result.skillSpAwards).toEqual([
      expect.objectContaining({
        baseAmount: 0.75,
        learningRateMultiplier: 2,
        amount: 1.5,
        potentialEffect: 3,
      }),
    ]);
  });
});

describe("skills, stress, recovery, and task semantics", () => {
  it("creates discovery at Level 1 and rejects duplicates or artificial hyper-specialization", async () => {
    const game = gameWithActors();
    const session = await runtime(game).createWorld("Emergent skills");
    const accepted = createEmergentSkillInputSchema.parse({
      actorId: "campaign.entity.amelia",
      proposal: {
        id: "skill.safecracking",
        name: "Safecracking",
        description: "Specialized diagnosis and manipulation of secure safes.",
        specificity: 4,
        reason: "discovery",
      },
      semanticReview: {
        decision: "accepted",
        comparedAgainstExistingSkills: true,
        specificityJustification:
          "Dedicated knowledge and practice beyond general lock manipulation.",
      },
      authorized: true,
      scopeIds: [],
    });
    const created = await session.executeOperation(
      "rules.skills.create-emergent-skill",
      accepted,
    );
    expect(created).toEqual(expect.objectContaining({
      skill: expect.objectContaining({ sp: 2, level: 1, visible: true }),
    }));

    const learning = await session.executeOperation(
      "rules.skills.create-emergent-skill",
      {
        ...accepted,
        proposal: {
          id: "skill.glassblowing",
          name: "Glassblowing",
          description: "Developing practical control of heated glass.",
          specificity: 3,
          reason: "learning",
        },
        semanticReview: {
          decision: "accepted",
          comparedAgainstExistingSkills: true,
          specificityJustification:
            "A focused discipline that requires distinct practice.",
        },
      },
    );
    expect(learning).toEqual(expect.objectContaining({
      skill: expect.objectContaining({ sp: 0, level: 0, visible: false }),
    }));

    await expect(session.executeOperation(
      "rules.skills.create-emergent-skill",
      {
        ...accepted,
        proposal: {
          ...accepted.proposal,
          id: "skill.social-deception",
          name: "Social Deception",
        },
        semanticReview: {
          decision: "duplicate",
          existingSkillId: "skill.charm",
          rationale: "The existing social competency covers this demonstration.",
        },
      },
    )).rejects.toThrow(/duplicates/i);
    await expect(session.executeOperation(
      "rules.skills.create-emergent-skill",
      {
        ...accepted,
        proposal: {
          ...accepted.proposal,
          id: "skill.lockpick-rainy-tuesday",
          name: "Lockpicking on Rainy Tuesdays",
        },
        semanticReview: {
          decision: "over-narrow",
          rationale: "Circumstantial wording exists only to claim specificity 4.",
        },
      },
    )).rejects.toThrow(/hyper-specialization/i);
  });

  it("structures Taken Out, contextual Injury status, and PC fatal consent without automatic death", async () => {
    const player = actorState({
      isPlayerCharacter: true,
      stress: {
        injury: 4,
        fear: 0,
        anger: 0,
        exhaustion: 0,
        insecurity: 0,
      },
    });
    const rival = actorState({
      skills: versatileSkills,
      stress: {
        injury: 4,
        fear: 0,
        anger: 0,
        exhaustion: 0,
        insecurity: 0,
      },
    });
    const game = gameWithActors(undefined, rival, player);
    const session = await runtime(game).createWorld("Taken Out");
    const input = actionInput("action.taken-out", {
      approach: "deliver a potentially fatal physical strike",
      resistance: {
        kind: "fixed",
        value: 1,
        provenance: {
          kind: "direct",
          description: "The already-established strike connects.",
        },
      },
      effect: { mode: "fixed", potentialEffect: 1 },
      stressConsequence: {
        targetId: "campaign.entity.player",
        track: "injury",
        statusOnTakenOut: {
          id: "status.mortal-wound",
          name: "Mortal Wound",
          description: "Normally fatal without the player's death consent.",
          attributeModifiers: [],
          performanceModifiers: [
            {
              id: "status.mortal-wound.performance",
              description: "Severe injury impairs overall function.",
              percent: -40,
            },
          ],
        },
        normallyFatal: true,
        pcDeathConsent: false,
      },
    });
    const envelope = await session.resolve<ResolveActionResult>({
      intent: intent(),
      operation: { id: actionOperationId, input },
    });
    expect(envelope.result.takenOut).toEqual([
      expect.objectContaining({
        actorId: "campaign.entity.player",
        track: "injury",
        fatalToPcPendingConsent: true,
        fatalOutcome: "pc-pending-consent",
        deathAccepted: false,
      }),
    ]);
    const updated = rulesActorStateSchema.parse(
      session.snapshot().entities.find(
        (entity) => entity.id === "campaign.entity.player",
      )!.data.mechanics,
    );
    expect(updated.stress.injury).toBe(5);
    expect(updated.statuses.map((status) => status.id)).toContain(
      "status.mortal-wound",
    );
    expect(JSON.stringify(updated)).not.toContain('"dead"');

    const npcFatal = await session.resolve<ResolveActionResult>({
      intent: intent(),
      operation: {
        id: actionOperationId,
        input: actionInput("action.npc-fatal", {
          resistance: {
            kind: "fixed",
            value: 1,
            provenance: {
              kind: "direct",
              description: "The established lethal action connects.",
            },
          },
          effect: { mode: "fixed", potentialEffect: 1 },
          stressConsequence: {
            targetId: "campaign.entity.rival",
            track: "injury",
            normallyFatal: true,
            pcDeathConsent: false,
          },
        }),
      },
    });
    expect(npcFatal.result.takenOut).toEqual([
      expect.objectContaining({
        actorId: "campaign.entity.rival",
        fatalOutcome: "npc-fatal",
        fatalToPcPendingConsent: false,
      }),
    ]);

    const nonlethalSession = await runtime(game).createWorld(
      "Nonlethal Taken Out",
    );
    const npcNonlethal = await nonlethalSession.resolve<ResolveActionResult>({
      intent: intent(),
      operation: {
        id: actionOperationId,
        input: actionInput("action.npc-nonlethal", {
          approach: "subdue the rival without lethal force",
          resistance: {
            kind: "fixed",
            value: 1,
            provenance: {
              kind: "direct",
              description: "The established nonlethal action connects.",
            },
          },
          effect: { mode: "fixed", potentialEffect: 1 },
          stressConsequence: {
            targetId: "campaign.entity.rival",
            track: "injury",
            normallyFatal: false,
            pcDeathConsent: false,
          },
        }),
      },
    });
    expect(npcNonlethal.result.takenOut).toEqual([
      expect.objectContaining({ fatalOutcome: "nonfatal" }),
    ]);
  });

  it("requires causal recovery, uses baseline cadence, and leaves statuses in place", () => {
    const amelia = actorState({
      stress: {
        injury: 2,
        fear: 3,
        anger: 0,
        exhaustion: 0,
        insecurity: 0,
      },
      statuses: [
        {
          id: "status.broken-hand",
          name: "Broken Hand",
          description: "A persistent injury requiring treatment and healing.",
          attributeModifiers: [
            {
              id: "status.broken-hand.fine-motor",
              description: "The injured hand impairs fine manipulation.",
              attributeId: "fine-motor-skills",
              percent: -40,
            },
          ],
          performanceModifiers: [],
        },
      ],
    });
    const game = gameWithActors(amelia);
    const world = initializeCampaignWorld(game, 0x1234_5678);
    expect(() => recoverStressInputSchema.parse({
      actorId: "campaign.entity.amelia",
      track: "injury",
      basis: {
        kind: "rest",
        description: "Ordinary rest alone.",
        durationMs: 8 * 60 * 60 * 1_000,
        restfulOvernight: true,
      },
      scopeIds: [],
    })).not.toThrow();
    expect(() => executeRulesOperation(
      game.operationRegistry,
      "rules.recovery.recover-stress",
      { world },
      {
        actorId: "campaign.entity.amelia",
        track: "injury",
        basis: {
          kind: "rest",
          description: "Ordinary rest alone.",
          durationMs: 8 * 60 * 60 * 1_000,
          restfulOvernight: true,
        },
        scopeIds: [],
      },
    )).toThrow(/treatment or healing/i);

    const fear = executeRulesOperation(
      game.operationRegistry,
      "rules.recovery.recover-stress",
      { world },
      {
        actorId: "campaign.entity.amelia",
        track: "fear",
        basis: {
          kind: "safety",
          description: "Sustained safety and regained control.",
          durationMs: 70 * 60 * 1_000,
          restfulOvernight: false,
        },
        scopeIds: [],
      },
    );
    expect(fear.result).toEqual(expect.objectContaining({
      before: 3,
      recovered: 2,
      after: 1,
      statusesRemain: ["status.broken-hand"],
    }));

    const injury = executeRulesOperation(
      game.operationRegistry,
      "rules.recovery.recover-stress",
      { world },
      {
        actorId: "campaign.entity.amelia",
        track: "injury",
        basis: {
          kind: "treatment",
          description: "The fracture is set and medically stabilized.",
          justifiedAmount: 1,
        },
        scopeIds: [],
      },
    );
    expect(injury.result).toEqual(expect.objectContaining({
      recovered: 1,
      statusesRemain: ["status.broken-hand"],
    }));
  });

  it("represents meaningful extended stages, real retry changes, and obvious/simultaneous timing without a scheduler", () => {
    const game = gameWithActors();
    const world = initializeCampaignWorld(game, 0x1234_5678);
    const extended = extendedTaskSchema.parse({
      goal: "research and safely test an unfamiliar compound",
      stages: [
        {
          id: "stage.research",
          description: "Research likely composition and hazards.",
          expectedDurationMs: 60 * 60 * 1_000,
          changes: ["competency", "decision"],
        },
        {
          id: "stage.experiment",
          description: "Run a controlled experiment based on findings.",
          expectedDurationMs: 30 * 60 * 1_000,
          changes: ["resistance", "circumstances", "consequences"],
        },
      ],
    });
    const stageResult = executeRulesOperation(
      game.operationRegistry,
      "rules.tasks.validate-extended-task",
      { world },
      extended,
    );
    expect(stageResult.result).toEqual({
      stageCount: 2,
      totalExpectedDurationMs: 90 * 60 * 1_000,
      stageIds: ["stage.research", "stage.experiment"],
    });
    expect(() => extendedTaskSchema.parse({
      goal: "build a house in one roll",
      stages: [extended.stages[0]],
    })).toThrow();
    expect(repeatAttemptSchema.parse({
      priorActionId: "action.failed-lock",
      changes: ["time", "preparation"],
      description: "Take time to inspect and lubricate the mechanism.",
    })).toBeDefined();
    expect(() => repeatAttemptSchema.parse({
      priorActionId: "action.failed-lock",
      changes: [],
      description: "Instantly reroll without changing anything.",
    })).toThrow();

    const timing = executeRulesOperation<unknown, {
      groups: Array<{
        timeToMaterialEffectMs: number;
        intentIds: string[];
        simultaneous: boolean;
      }>;
    }>(
      game.operationRegistry,
      "rules.timing.order-material-effects",
      { world },
      {
        effects: [
          materialEffectSchema.parse({
            intentId: "intent.slow",
            timeToMaterialEffectMs: 3_000,
          }),
          materialEffectSchema.parse({
            intentId: "intent.fast",
            timeToMaterialEffectMs: 1_000,
          }),
          materialEffectSchema.parse({
            intentId: "intent.tie",
            timeToMaterialEffectMs: 1_000,
          }),
        ],
      },
    );
    expect(timing.result.groups).toEqual([
      {
        timeToMaterialEffectMs: 1_000,
        intentIds: ["intent.fast", "intent.tie"],
        simultaneous: true,
      },
      {
        timeToMaterialEffectMs: 3_000,
        intentIds: ["intent.slow"],
        simultaneous: false,
      },
    ]);

    const concession = executeRulesOperation<unknown, {
      actorId: string;
      conceded: true;
      outcome: string;
    }>(
      game.operationRegistry,
      "rules.actions.concede",
      { world },
      {
        actorId: "campaign.entity.rival",
        contest: "the foot race",
        outcome: "drops out and yields the route",
        durationMs: 500,
        scopeIds: [],
      },
    );
    expect(concession.result).toEqual({
      actorId: "campaign.entity.rival",
      conceded: true,
      outcome: "drops out and yields the route",
    });
  });
});
