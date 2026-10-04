import {
  actorGoalSchema,
  canonicalFactSchema,
  contentPlanningMaterialSchema,
  fictionalInstantSchema,
  jsonValueSchema,
  situationCandidateSchema,
  stableIdSchema,
  type EventTypeDefinition,
  type JsonValue,
  type MutationProposal,
  type WorldState,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import { densifyGeneratedEntity } from "./starting-region.js";

export const BROWNBAG_IDS = {
  store: "campaign.location.brownbag-groceries",
  nina: "campaign.entity.nina",
  manager: "campaign.entity.brownbag-manager",
  saltCustomer: "campaign.entity.salt-customer",
  keepJobGoal: "campaign.goal.nina-keep-job",
  managerConflict: "campaign.relationship.nina-manager",
  leavingGoal: "campaign.goal.nina-consider-leaving",
  agingEquipmentFact: "campaign.fact.brownbag-aging-equipment",
  financialPressureFact: "campaign.fact.brownbag-financial-pressure",
  saltPurchasesFact: "campaign.fact.salt-purchases",
  saltRumorBelief: "campaign.belief.nina-salt-rumor",
  freezerFact: "campaign.fact.freezer-3-failing",
  inventoryLossFact: "campaign.fact.brownbag-inventory-loss",
  socialDetail: "content.detail.social-1",
  freezerDetail: "content.detail.environmental-1",
  supernaturalDetail: "content.detail.supernatural-1",
  socialCandidate: "content.situation.social-1",
  environmentalCandidate: "content.situation.environmental-1",
  supernaturalCandidate: "content.situation.supernatural-1",
  socialHook: "content.hook.001",
  environmentalHook: "content.hook.002",
  supernaturalHook: "content.hook.003",
} as const;

export const brownbagDetailCommittedPayloadSchema = z.object({
  detailId: stableIdSchema,
  recordIds: z.array(stableIdSchema).min(1),
}).strict();

export const brownbagDetailCommittedEventType: EventTypeDefinition<
  z.infer<typeof brownbagDetailCommittedPayloadSchema>
> = {
  type: "campaign.brownbag-detail-committed",
  schemaVersion: 1,
  payloadSchema: brownbagDetailCommittedPayloadSchema,
};

export const brownbagConsequencePayloadSchema = z.object({
  factId: stableIdSchema,
  causeFactId: stableIdSchema,
}).strict();

export const brownbagConsequenceEventType: EventTypeDefinition<
  z.infer<typeof brownbagConsequencePayloadSchema>
> = {
  type: "campaign.brownbag-consequence",
  schemaVersion: 1,
  payloadSchema: brownbagConsequencePayloadSchema,
};

export const brownbagSocialActionPayloadSchema = z.object({
  actorId: stableIdSchema,
  goalId: stableIdSchema,
  action: z.literal("disclosed-intention"),
}).strict();

export const brownbagSocialActionEventType: EventTypeDefinition<
  z.infer<typeof brownbagSocialActionPayloadSchema>
> = {
  type: "campaign.brownbag-social-action",
  schemaVersion: 1,
  payloadSchema: brownbagSocialActionPayloadSchema,
};

function required<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}

function fact(world: WorldState, id: string) {
  return required(
    world.facts.find((item) => item.id === id),
    `Brownbag content source requires fact ${id}`,
  );
}

function social(world: WorldState, actorId: string) {
  return required(
    world.actorSocialStates.find((item) => item.actorId === actorId),
    `Brownbag content source requires social state ${actorId}`,
  );
}

/**
 * Builds protected, non-authoritative content material from the current local
 * state. Re-running after an ordinary state commit derives commitment evidence
 * and updated hook grounding; none of this material is stored in World State.
 */
export function buildBrownbagSituationMaterial(world: WorldState) {
  const nina = social(world, BROWNBAG_IDS.nina);
  const leavingGoal = nina.goals.find((item) => item.id === BROWNBAG_IDS.leavingGoal);
  const freezerFact = world.facts.find((item) => item.id === BROWNBAG_IDS.freezerFact);
  const agingEquipment = fact(world, BROWNBAG_IDS.agingEquipmentFact);
  const financialPressure = fact(world, BROWNBAG_IDS.financialPressureFact);
  const saltPurchases = fact(world, BROWNBAG_IDS.saltPurchasesFact);
  required(
    world.beliefs.find((item) => item.id === BROWNBAG_IDS.saltRumorBelief),
    `Brownbag content source requires belief ${BROWNBAG_IDS.saltRumorBelief}`,
  );

  const socialGrounding = [
    { kind: "entity" as const, id: BROWNBAG_IDS.store },
    { kind: "actor-goal" as const, id: BROWNBAG_IDS.keepJobGoal },
    { kind: "actor-relationship" as const, id: BROWNBAG_IDS.managerConflict },
    { kind: "actor-social-state" as const, id: BROWNBAG_IDS.nina },
    ...(leavingGoal
      ? [{ kind: "actor-goal" as const, id: BROWNBAG_IDS.leavingGoal }]
      : []),
  ];
  const environmentalGrounding = [
    { kind: "fact" as const, id: agingEquipment.id },
    { kind: "fact" as const, id: financialPressure.id },
    ...(freezerFact
      ? [{ kind: "fact" as const, id: freezerFact.id }]
      : []),
  ];

  return contentPlanningMaterialSchema.parse({
    provisionalDetails: [
      {
        id: BROWNBAG_IDS.socialDetail,
        summary: "Nina may be considering leaving because manager conflict is worsening.",
        durability: "persistent",
        constraints: socialGrounding.slice(0, 3),
        provenance: {
          pattern: "simulation-emergent",
          sourceIds: [BROWNBAG_IDS.keepJobGoal, BROWNBAG_IDS.managerConflict],
          rationale: "Existing goals and relationship strain create a grounded possibility.",
        },
      },
      {
        id: BROWNBAG_IDS.freezerDetail,
        summary: "One specific aging freezer may be close to failure.",
        durability: "persistent",
        constraints: environmentalGrounding.slice(0, 2),
        provenance: {
          pattern: "query-driven-local-generation",
          sourceIds: [agingEquipment.id, financialPressure.id],
          rationale: "Local interaction requires the smallest missing equipment detail.",
        },
      },
      {
        id: BROWNBAG_IDS.supernaturalDetail,
        summary: "The salt customer may be responding to an unrevealed supernatural problem.",
        durability: "persistent",
        constraints: [
          { kind: "fact", id: saltPurchases.id },
          { kind: "belief", id: BROWNBAG_IDS.saltRumorBelief },
        ],
        provenance: {
          pattern: "authored-seed",
          sourceIds: [saltPurchases.id, BROWNBAG_IDS.saltRumorBelief],
          rationale: "Authored observable behavior supports a protected possibility, not truth.",
        },
      },
    ],
    commitmentEvidence: [
      ...(leavingGoal
        ? [{
            detailId: BROWNBAG_IDS.socialDetail,
            assertions: [{
              reference: { kind: "actor-goal", id: leavingGoal.id },
              expectedValue: jsonValueSchema.parse(leavingGoal),
            }],
          }]
        : []),
      ...(freezerFact
        ? [{
            detailId: BROWNBAG_IDS.freezerDetail,
            assertions: [
              {
                reference: {
                  kind: "entity",
                  id: BROWNBAG_IDS.store,
                  path: ["data", "equipment", "freezers", 0, "condition"],
                },
                expectedValue: "failing",
              },
              {
                reference: { kind: "fact", id: freezerFact.id },
                expectedValue: jsonValueSchema.parse(freezerFact),
              },
            ],
          }]
        : []),
    ],
    candidates: [
      situationCandidateSchema.parse({
        id: BROWNBAG_IDS.socialCandidate,
        sourcePattern: "simulation-emergent",
        summary: "Existing job pressure and manager conflict may develop socially.",
        grounding: socialGrounding,
        provisionalDetailIds: [BROWNBAG_IDS.socialDetail],
        conditionalDevelopments: [{
          summary: "If conflict continues, Nina may decide to leave.",
          grounding: socialGrounding.slice(0, 3),
        }],
        discoveryAffordances: [{
          id: BROWNBAG_IDS.socialHook,
          kind: "conversation",
          gmSummary: "Nina could truthfully raise her committed intention in conversation.",
          perspective: {
            role: "actor",
            perspective: { kind: "actor", id: BROWNBAG_IDS.nina },
            focalActorId: BROWNBAG_IDS.nina,
          },
          grounding: socialGrounding,
          surfaceGrounding: [{
            kind: "actor-social-state",
            id: BROWNBAG_IDS.nina,
          }],
          requiredDetailIds: [BROWNBAG_IDS.socialDetail],
        }],
      }),
      situationCandidateSchema.parse({
        id: BROWNBAG_IDS.environmentalCandidate,
        sourcePattern: "query-driven-local-generation",
        summary: "A specific refrigeration fault can be realized under coarse store truth.",
        grounding: environmentalGrounding,
        provisionalDetailIds: [BROWNBAG_IDS.freezerDetail],
        conditionalDevelopments: [{
          summary: "If an actual failure remains unresolved, ordinary inventory loss may follow.",
          grounding: environmentalGrounding,
        }],
        discoveryAffordances: [{
          id: BROWNBAG_IDS.environmentalHook,
          kind: "observation",
          gmSummary: "Observable evidence of a committed freezer fault may enter scene context.",
          perspective: {
            role: "actor",
            perspective: { kind: "actor", id: "campaign.entity.amelia" },
            focalActorId: "campaign.entity.amelia",
          },
          grounding: environmentalGrounding,
          surfaceGrounding: [{
            kind: "fact",
            id: freezerFact?.id ?? agingEquipment.id,
          }],
          requiredDetailIds: [BROWNBAG_IDS.freezerDetail],
        }],
      }),
      situationCandidateSchema.parse({
        id: BROWNBAG_IDS.supernaturalCandidate,
        sourcePattern: "authored-seed",
        summary: "Observable salt buying may support a hidden supernatural possibility.",
        grounding: [
          { kind: "entity", id: BROWNBAG_IDS.saltCustomer },
          { kind: "fact", id: saltPurchases.id },
          { kind: "belief", id: BROWNBAG_IDS.saltRumorBelief },
        ],
        provisionalDetailIds: [BROWNBAG_IDS.supernaturalDetail],
        conditionalDevelopments: [{
          summary: "Further supernatural truth may be committed only if later play requires it.",
          grounding: [{ kind: "fact", id: saltPurchases.id }],
        }],
        discoveryAffordances: [{
          id: BROWNBAG_IDS.supernaturalHook,
          kind: "observation",
          gmSummary: "The repeated purchases are observable without revealing their hidden reason.",
          perspective: {
            role: "actor",
            perspective: { kind: "actor", id: "campaign.entity.amelia" },
            focalActorId: "campaign.entity.amelia",
          },
          grounding: [
            { kind: "fact", id: saltPurchases.id },
            { kind: "belief", id: BROWNBAG_IDS.saltRumorBelief },
          ],
          surfaceGrounding: [{ kind: "fact", id: saltPurchases.id }],
          requiredDetailIds: [],
        }],
      }),
    ],
  });
}

export function proposeBrownbagSocialDetailCommit(
  world: WorldState,
  occurredAtValue: unknown,
): readonly MutationProposal[] {
  social(world, BROWNBAG_IDS.nina);
  const occurredAt = fictionalInstantSchema.parse(occurredAtValue);
  const goal = actorGoalSchema.parse({
    id: BROWNBAG_IDS.leavingGoal,
    description: "Decide whether to leave Brownbag for another job.",
    priority: 0.7,
    status: "active",
    relatedEntityIds: [BROWNBAG_IDS.store, BROWNBAG_IDS.manager],
    createdAt: occurredAt,
  });
  return [{
    kind: "upsert-actor-goal",
    actorId: BROWNBAG_IDS.nina,
    goal,
  }];
}

export function proposeBrownbagFreezerDetailCommit(
  world: WorldState,
): readonly MutationProposal[] {
  const store = required(
    world.entities.find((item) => item.id === BROWNBAG_IDS.store),
    `Missing Brownbag entity ${BROWNBAG_IDS.store}`,
  );
  const equipment = jsonValueSchema.parse({
    ...(store.data.equipment as Record<string, JsonValue>),
    freezers: [{
      id: "brownbag.freezer.3",
      location: "rear frozen-food aisle",
      condition: "failing",
      symptom: "intermittent coolant leak",
    }],
  });
  const densified = densifyGeneratedEntity(store, {
    entityId: store.id,
    candidateData: {
      ...store.data,
      equipment,
    },
    requiredPaths: ["equipment.freezers"],
    provenance: {
      class: "later-densification",
      sourceIds: [BROWNBAG_IDS.agingEquipmentFact],
      rationale: "A close local interaction requires one specific refrigeration fault.",
    },
  });
  const freezerFact = canonicalFactSchema.parse({
    id: BROWNBAG_IDS.freezerFact,
    subjectId: BROWNBAG_IDS.store,
    predicate: "equipment.freezer-condition",
    value: {
      freezerId: "brownbag.freezer.3",
      condition: "failing",
      symptom: "intermittent coolant leak",
    },
    visibility: "public",
    tags: ["equipment", "environmental"],
  });
  return [
    ...densified.mutations,
    { kind: "upsert-fact", fact: freezerFact },
  ];
}

export function proposeBrownbagInventoryLoss(
  world: WorldState,
): readonly MutationProposal[] {
  fact(world, BROWNBAG_IDS.freezerFact);
  return [
    {
      kind: "set-entity-data",
      entityId: BROWNBAG_IDS.store,
      key: "inventory-status",
      value: "frozen inventory spoiled after the committed equipment failure",
    },
    {
      kind: "upsert-fact",
      fact: canonicalFactSchema.parse({
        id: BROWNBAG_IDS.inventoryLossFact,
        subjectId: BROWNBAG_IDS.store,
        predicate: "inventory.loss",
        value: "frozen inventory spoiled",
        visibility: "public",
        tags: ["economy", "consequence"],
      }),
    },
  ];
}
