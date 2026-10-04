import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ContentPlanningValidationError,
  assessDiscoveryAffordanceReadiness,
  assessSituationCandidateGrounding,
  createAuthoritativeGroundingCatalog,
  createGameRuntime,
  createInMemoryPersistence,
  executeEngineQueryTool,
  fictionalDurationMs,
  loadGameDefinition,
  prepareDiscoveryAffordance,
  type ContextQueryAuthorization,
  type GameDefinition,
  type GroundingReference,
  type PerspectiveGroundingAccess,
  type RulesOperation,
} from "@llm-ttrpg/engine";
import {
  BROWNBAG_IDS,
  buildBrownbagSituationMaterial,
  densifyGeneratedEntity,
  proposeBrownbagFreezerDetailCommit,
  proposeBrownbagInventoryLoss,
  proposeBrownbagSocialDetailCommit,
  referenceGameDefinition,
} from "@llm-ttrpg/reference-game";

const fixtureActionSchema = z.enum([
  "commit-social-detail",
  "disclose-social-intention",
  "commit-freezer-detail",
  "record-inventory-loss",
]);

const brownbagFixtureOperation: RulesOperation<
  { action: z.infer<typeof fixtureActionSchema> },
  { action: z.infer<typeof fixtureActionSchema> }
> = {
  metadata: {
    id: "rules.actions.brownbag-content-fixture",
    kind: "ordinary",
    description: "Exercise content-specific commits through ordinary mutations and events.",
    category: {
      domain: { id: "rules", label: "Rules" },
      subsystem: { id: "actions", label: "Actions" },
      tags: ["content", "fixture"],
    },
  },
  inputSchema: z.object({ action: fixtureActionSchema }).strict(),
  outputSchema: z.object({ action: fixtureActionSchema }).strict(),
  execute(context, input) {
    if (input.action === "disclose-social-intention") {
      const canonicalGoal = context.world.actorSocialStates
        .find((item) => item.actorId === BROWNBAG_IDS.nina)
        ?.goals.find((item) => item.id === BROWNBAG_IDS.leavingGoal);
      if (!canonicalGoal) {
        throw new Error("Nina cannot act from an uncommitted provisional intention");
      }
      return {
        result: input,
        advanceTimeByMs: fictionalDurationMs(0),
        proposedMutations: [],
        proposedEvents: [{
          type: "campaign.brownbag-social-action",
          schemaVersion: 1,
          summary: "Nina disclosed that she is considering leaving Brownbag.",
          relatedEntityIds: [BROWNBAG_IDS.nina, BROWNBAG_IDS.store],
          scopeIds: ["scope.reference-scene"],
          causedByEventIds: [],
          payload: {
            actorId: BROWNBAG_IDS.nina,
            goalId: BROWNBAG_IDS.leavingGoal,
            action: "disclosed-intention",
          },
          access: "public",
        }],
      };
    }

    if (input.action === "record-inventory-loss") {
      return {
        result: input,
        advanceTimeByMs: fictionalDurationMs(0),
        proposedMutations: proposeBrownbagInventoryLoss(context.world as never),
        proposedEvents: [{
          type: "campaign.brownbag-consequence",
          schemaVersion: 1,
          summary: "Frozen inventory spoiled after the committed freezer fault persisted.",
          relatedEntityIds: [BROWNBAG_IDS.store],
          scopeIds: ["scope.reference-scene"],
          causedByEventIds: [],
          payload: {
            factId: BROWNBAG_IDS.inventoryLossFact,
            causeFactId: BROWNBAG_IDS.freezerFact,
          },
          access: "public",
        }],
      };
    }

    const social = input.action === "commit-social-detail";
    const mutations = social
      ? proposeBrownbagSocialDetailCommit(
          context.world as never,
          context.world.fictionalTime,
        )
      : proposeBrownbagFreezerDetailCommit(context.world as never);
    const detailId = social ? BROWNBAG_IDS.socialDetail : BROWNBAG_IDS.freezerDetail;
    const recordIds = social
      ? [BROWNBAG_IDS.leavingGoal]
      : [BROWNBAG_IDS.store, BROWNBAG_IDS.freezerFact];
    return {
      result: input,
      advanceTimeByMs: fictionalDurationMs(0),
      proposedMutations: mutations,
      proposedEvents: [{
        type: "campaign.brownbag-detail-committed",
        schemaVersion: 1,
        summary: `Committed Brownbag detail ${detailId} through ordinary records.`,
        relatedEntityIds: social
          ? [BROWNBAG_IDS.nina, BROWNBAG_IDS.store]
          : [BROWNBAG_IDS.store],
        scopeIds: ["scope.reference-scene"],
        causedByEventIds: [],
        payload: { detailId, recordIds },
        access: "gm-only",
      }],
    };
  },
};

function fixtureDefinition(): GameDefinition {
  return {
    ...referenceGameDefinition,
    ruleset: {
      ...referenceGameDefinition.ruleset,
      operations: [
        ...referenceGameDefinition.ruleset.operations,
        brownbagFixtureOperation,
      ],
    },
  };
}

function candidate(
  material: ReturnType<typeof buildBrownbagSituationMaterial>,
  id: string,
) {
  const value = material.candidates.find((item) => item.id === id);
  if (!value) throw new Error(`Missing candidate ${id}`);
  return value;
}

function authorization(actorId: string): ContextQueryAuthorization {
  return {
    role: "actor",
    perspective: { kind: "actor", id: actorId },
    focalActorId: actorId,
  };
}

function access(
  auth: ContextQueryAuthorization,
  references: readonly GroundingReference[],
): PerspectiveGroundingAccess {
  return {
    authorization: auth,
    affordanceLocalRef: "local.hook",
    references: references.map((reference, index) => ({
      reference,
      localRef: `local.content-${index + 1}`,
    })),
  };
}

describe("Brownbag grounded content seam", () => {
  it("commits persistent detail before perspective-safe use and keeps outcomes ordinary", async () => {
    const game = loadGameDefinition(fixtureDefinition());
    const persistence = createInMemoryPersistence();
    let nextId = 0;
    const session = await createGameRuntime({
      persistence,
      wallClock: { now: () => "2026-04-12T14:00:00.000Z" },
      idGenerator: { next: (kind) => `${kind}.content-${++nextId}` },
      worldSeedSource: { nextSeed: () => 0x2617_0026 },
      game,
    }).createWorld("Brownbag content seam");

    const initial = session.snapshot();
    const initialMaterial = buildBrownbagSituationMaterial(initial);
    const initialCatalog = createAuthoritativeGroundingCatalog(
      initial,
      await session.eventHistory(),
    );
    expect(initialMaterial.candidates.map((item) => item.sourcePattern).sort())
      .toEqual([
        "authored-seed",
        "query-driven-local-generation",
        "simulation-emergent",
      ]);
    for (const item of initialMaterial.candidates) {
      expect(assessSituationCandidateGrounding(
        item,
        initialMaterial,
        initialCatalog,
      ).grounded).toBe(true);
    }
    expect(JSON.stringify(initial)).not.toContain(BROWNBAG_IDS.socialDetail);
    expect(JSON.stringify(initial)).not.toContain(BROWNBAG_IDS.freezerDetail);
    expect(initial).not.toHaveProperty("situations");
    expect(initial).not.toHaveProperty("quests");

    const socialBinding = game.toolCatalog.resolveBinding("knowledge.social.retrieve");
    const ninaAuth = authorization(BROWNBAG_IDS.nina);
    const ninaBefore = await executeEngineQueryTool(
      socialBinding,
      initial,
      {},
      { authorization: ninaAuth },
    ) as {
      actorId: string;
      goals: Array<{ id: string }>;
      relationships: Array<{ id: string }>;
    };
    const socialAccessBefore = access(ninaAuth, [
      { kind: "actor-social-state", id: ninaBefore.actorId },
      ...ninaBefore.goals.map((item) => ({ kind: "actor-goal" as const, id: item.id })),
      ...ninaBefore.relationships.map((item) => ({
        kind: "actor-relationship" as const,
        id: item.id,
      })),
    ]);
    const socialCandidate = candidate(initialMaterial, BROWNBAG_IDS.socialCandidate);
    expect(assessDiscoveryAffordanceReadiness(
      socialCandidate,
      BROWNBAG_IDS.socialHook,
      initialMaterial,
      initialCatalog,
      socialAccessBefore,
    )).toEqual(expect.objectContaining({
      ready: false,
      unresolvedDetailIds: [BROWNBAG_IDS.socialDetail],
    }));
    expect(() => prepareDiscoveryAffordance(
      socialCandidate,
      BROWNBAG_IDS.socialHook,
      initialMaterial,
      initialCatalog,
      socialAccessBefore,
    )).toThrow(ContentPlanningValidationError);
    await expect(session.executeOperation(
      "rules.actions.brownbag-content-fixture",
      { action: "disclose-social-intention" },
    )).rejects.toThrow(/uncommitted provisional intention/i);
    await expect(executeEngineQueryTool(
      socialBinding,
      initial,
      { actorId: BROWNBAG_IDS.nina },
      { authorization: authorization("campaign.entity.amelia") },
    )).rejects.toThrow(/only their own social state/i);

    await session.executeOperation("rules.actions.brownbag-content-fixture", {
      action: "commit-social-detail",
    });
    const socialWorld = session.snapshot();
    const socialMaterial = buildBrownbagSituationMaterial(socialWorld);
    const socialCatalog = createAuthoritativeGroundingCatalog(
      socialWorld,
      await session.eventHistory(),
    );
    const ninaAfter = await executeEngineQueryTool(
      socialBinding,
      socialWorld,
      {},
      { authorization: ninaAuth },
    ) as typeof ninaBefore;
    expect(ninaAfter.goals.map((item) => item.id)).toContain(BROWNBAG_IDS.leavingGoal);
    const socialAccessAfter = access(ninaAuth, [
      { kind: "actor-social-state", id: ninaAfter.actorId },
      ...ninaAfter.goals.map((item) => ({ kind: "actor-goal" as const, id: item.id })),
      ...ninaAfter.relationships.map((item) => ({
        kind: "actor-relationship" as const,
        id: item.id,
      })),
    ]);
    const preparedSocial = prepareDiscoveryAffordance(
      candidate(socialMaterial, BROWNBAG_IDS.socialCandidate),
      BROWNBAG_IDS.socialHook,
      socialMaterial,
      socialCatalog,
      socialAccessAfter,
    );
    expect(preparedSocial).toEqual({
      affordanceRef: "local.hook",
      kind: "conversation",
      surfaceRefs: ["local.content-1"],
    });
    expect(preparedSocial).not.toHaveProperty("gmSummary");
    expect(JSON.stringify(preparedSocial)).not.toContain("considering leaving");
    await session.executeOperation("rules.actions.brownbag-content-fixture", {
      action: "disclose-social-intention",
    });

    const knowledgeBinding = game.toolCatalog.resolveBinding("knowledge.facts.retrieve");
    const ameliaAuth = authorization("campaign.entity.amelia");
    const ameliaKnowledgeBefore = await executeEngineQueryTool(
      knowledgeBinding,
      session.snapshot(),
      { subjectId: BROWNBAG_IDS.store },
      { authorization: ameliaAuth },
    ) as { facts: Array<{ id: string }>; beliefs: Array<{ id: string }> };
    expect(ameliaKnowledgeBefore.facts.map((item) => item.id)).toContain(
      BROWNBAG_IDS.agingEquipmentFact,
    );
    expect(ameliaKnowledgeBefore.facts.map((item) => item.id)).not.toContain(
      BROWNBAG_IDS.financialPressureFact,
    );
    const environmentBefore = buildBrownbagSituationMaterial(session.snapshot());
    const environmentCatalogBefore = createAuthoritativeGroundingCatalog(
      session.snapshot(),
      await session.eventHistory(),
    );
    const environmentAccessBefore = access(
      ameliaAuth,
      ameliaKnowledgeBefore.facts.map((item) => ({ kind: "fact", id: item.id })),
    );
    expect(assessDiscoveryAffordanceReadiness(
      candidate(environmentBefore, BROWNBAG_IDS.environmentalCandidate),
      BROWNBAG_IDS.environmentalHook,
      environmentBefore,
      environmentCatalogBefore,
      environmentAccessBefore,
    ).ready).toBe(false);

    await session.executeOperation("rules.actions.brownbag-content-fixture", {
      action: "commit-freezer-detail",
    });
    const committed = session.snapshot();
    const committedMaterial = buildBrownbagSituationMaterial(committed);
    const committedCatalog = createAuthoritativeGroundingCatalog(
      committed,
      await session.eventHistory(),
    );
    const ameliaKnowledgeAfter = await executeEngineQueryTool(
      knowledgeBinding,
      committed,
      { subjectId: BROWNBAG_IDS.store },
      { authorization: ameliaAuth },
    ) as typeof ameliaKnowledgeBefore;
    const environmentAccessAfter = access(
      ameliaAuth,
      ameliaKnowledgeAfter.facts.map((item) => ({ kind: "fact", id: item.id })),
    );
    expect(prepareDiscoveryAffordance(
      candidate(committedMaterial, BROWNBAG_IDS.environmentalCandidate),
      BROWNBAG_IDS.environmentalHook,
      committedMaterial,
      committedCatalog,
      environmentAccessAfter,
    ).surfaceRefs).toHaveLength(1);

    const committedStore = committed.entities.find((item) => item.id === BROWNBAG_IDS.store)!;
    expect(() => densifyGeneratedEntity(committedStore, {
      entityId: committedStore.id,
      candidateData: {
        ...committedStore.data,
        equipment: {
          ...(committedStore.data.equipment as object),
          freezers: [{
            id: "brownbag.freezer.3",
            location: "rear frozen-food aisle",
            condition: "healthy",
            symptom: "none",
          }],
        },
      },
      requiredPaths: ["equipment.freezers"],
      provenance: {
        class: "later-densification",
        sourceIds: [BROWNBAG_IDS.freezerFact],
        rationale: "Invalid rewrite after commitment.",
      },
    })).toThrow(/retcon/i);
    expect(() => densifyGeneratedEntity(committedStore, {
      entityId: committedStore.id,
      candidateData: {
        ...committedStore.data,
        "loading-dock-note": "A separate undefined detail may still be established.",
      },
      requiredPaths: ["loading-dock-note"],
      provenance: {
        class: "later-densification",
        sourceIds: [BROWNBAG_IDS.store],
        rationale: "Unrelated undefined detail remains available for densification.",
      },
    })).not.toThrow();

    const customerKnowledge = await executeEngineQueryTool(
      knowledgeBinding,
      committed,
      { subjectId: BROWNBAG_IDS.saltCustomer },
      { authorization: ameliaAuth },
    ) as typeof ameliaKnowledgeBefore;
    const supernaturalAccess = access(
      ameliaAuth,
      customerKnowledge.facts.map((item) => ({ kind: "fact", id: item.id })),
    );
    const beforeIgnoring = session.snapshot();
    const preparedSupernatural = prepareDiscoveryAffordance(
      candidate(committedMaterial, BROWNBAG_IDS.supernaturalCandidate),
      BROWNBAG_IDS.supernaturalHook,
      committedMaterial,
      committedCatalog,
      supernaturalAccess,
    );
    expect(JSON.stringify(preparedSupernatural)).not.toMatch(/supernatural|rumor|reason/i);
    expect(session.snapshot()).toEqual(beforeIgnoring);
    expect(committed.facts.some((item) =>
      item.subjectId === BROWNBAG_IDS.saltCustomer &&
      item.predicate.includes("supernatural")
    )).toBe(false);
    const ninaRumor = await executeEngineQueryTool(
      knowledgeBinding,
      committed,
      { subjectId: BROWNBAG_IDS.saltCustomer },
      { authorization: ninaAuth },
    );
    expect(JSON.stringify(ninaRumor)).toContain("ward off something supernatural");
    expect(JSON.stringify(ninaRumor)).not.toContain("truthStatus");

    await session.executeOperation("rules.actions.brownbag-content-fixture", {
      action: "record-inventory-loss",
    });
    const final = session.snapshot();
    expect(final.facts.some((item) => item.id === BROWNBAG_IDS.inventoryLossFact))
      .toBe(true);
    expect(final.entities.find((item) => item.id === BROWNBAG_IDS.store)?.data)
      .toHaveProperty("inventory-status");
    expect((await session.eventHistory()).at(-1)?.type)
      .toBe("campaign.brownbag-consequence");
    expect(final).not.toHaveProperty("quests");
    expect(final).not.toHaveProperty("situations");
  });
});
