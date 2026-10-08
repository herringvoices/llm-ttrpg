import type { Ruleset } from "@llm-ttrpg/engine";
import { prepareReferenceActionAttempt } from "./attempt-preparer.js";
import {
  actionResolvedEventType,
  resolveActionOperation,
} from "./action-operation.js";
import {
  createEmergentSkillOperation,
  concedeOperation,
  concessionRecordedEventType,
  recoverStressOperation,
  skillCreatedEventType,
  stressRecoveredEventType,
} from "./state-operations.js";
import {
  applyCreatureGrowthOperation,
  creatureGrewEventType,
  mechanicsRealizedEventType,
  realizeMechanicsOperation,
} from "./mechanical-generation.js";
import {
  firstPowerManifestedEventType,
  manifestFirstPowerOperation,
} from "./awakening-operation.js";
import {
  openingTurnEvidencedEventType,
  recordOpeningTurnEvidenceOperation,
} from "./opening-evidence-operation.js";
import {
  activateInvincibleOperation,
  invincibleActivatedEventType,
} from "./invincible.js";
import {
  powerBehaviorDiscoveredEventType,
  recordPowerDiscoveryOperation,
} from "./power-discovery-operation.js";
import {
  orderMaterialEffectsOperation,
  validateExtendedTaskOperation,
  validateRepeatAttemptOperation,
} from "./task-operations.js";
import {
  routeTraversedEventType,
  traverseRouteOperation,
} from "./traversal-operation.js";
import {
  enterLocalPlaceOperation,
  localPlaceEnteredEventType,
} from "./local-place-operation.js";
import {
  completeRoutineTaskOperation,
  routineTaskCompletedEventType,
} from "./routine-task-operation.js";
import {
  applyConversationConsequencesOperation,
  callPlacedEventType,
  communicationRecordedEventType,
  conversationConsequencesAppliedEventType,
  placeCallOperation,
  recordCommunicationOperation,
} from "./conversation-operations.js";

export * from "./action-operation.js";
export * from "./attempt-preparer.js";
export * from "./awakening-operation.js";
export * from "./opening-evidence-operation.js";
export * from "./conversation-operations.js";
export * from "./invincible.js";
export * from "./local-place-operation.js";
export * from "./mechanics.js";
export * from "./mechanical-generation.js";
export * from "./model.js";
export * from "./power-discovery-operation.js";
export * from "./routine-task-operation.js";
export * from "./state-operations.js";
export * from "./task-operations.js";
export * from "./traversal-operation.js";

export const referenceRuleset: Ruleset = {
  prepareActionAttempt: prepareReferenceActionAttempt,
  identity: { id: "reference-rules", version: "0.3.0" },
  description:
    "Reusable, inspectable Performance-versus-Resistance rules for physical, mental, social, environmental, competitive, and high-pressure play.",
  toolCatalog: {
    domains: [
      {
        id: "rules",
        description:
          "Deterministic reference-game mechanics shared by PCs and NPCs across every kind of action.",
      },
    ],
    subsystems: [
      {
        id: "actions",
        domainId: "rules",
        description:
          "Unified Performance-versus-Resistance action resolution, Effect, stress, and consequences.",
      },
      {
        id: "recovery",
        domainId: "rules",
        description:
          "Fictionally grounded stress recovery that keeps persistent statuses distinct.",
      },
      {
        id: "skills",
        domainId: "rules",
        description:
          "Authorized learning and discovery of open-ended competencies after semantic review.",
      },
      {
        id: "progression",
        domainId: "rules",
        description:
          "Validated human awakening and character-progression thresholds.",
      },
      {
        id: "realization",
        domainId: "rules",
        description:
          "Demand-driven, no-retcon mechanical realization and species-appropriate growth.",
      },
      {
        id: "tasks",
        domainId: "rules",
        description:
          "Meaningful staging and retry validation for extended or repeated work.",
      },
      {
        id: "social",
        domainId: "rules",
        description:
          "Consequential communication, selective social persistence, and ordinary calls.",
      },
      {
        id: "timing",
        domainId: "rules",
        description:
          "Continuous-time material-effect ordering without combat rounds or initiative.",
      },
    ],
    queries: [],
  },
  operations: [
    resolveActionOperation,
    concedeOperation,
    recoverStressOperation,
    createEmergentSkillOperation,
    manifestFirstPowerOperation,
    recordOpeningTurnEvidenceOperation,
    activateInvincibleOperation,
    recordPowerDiscoveryOperation,
    realizeMechanicsOperation,
    applyCreatureGrowthOperation,
    validateExtendedTaskOperation,
    validateRepeatAttemptOperation,
    orderMaterialEffectsOperation,
    traverseRouteOperation,
    enterLocalPlaceOperation,
    completeRoutineTaskOperation,
    recordCommunicationOperation,
    applyConversationConsequencesOperation,
    placeCallOperation,
  ],
  eventTypes: [
    actionResolvedEventType,
    concessionRecordedEventType,
    skillCreatedEventType,
    stressRecoveredEventType,
    firstPowerManifestedEventType,
    openingTurnEvidencedEventType,
    invincibleActivatedEventType,
    powerBehaviorDiscoveredEventType,
    mechanicsRealizedEventType,
    creatureGrewEventType,
    routeTraversedEventType,
    localPlaceEnteredEventType,
    routineTaskCompletedEventType,
    communicationRecordedEventType,
    conversationConsequencesAppliedEventType,
    callPlacedEventType,
  ],
};
