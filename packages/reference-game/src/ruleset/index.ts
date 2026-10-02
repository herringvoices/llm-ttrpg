import type { Ruleset } from "@llm-ttrpg/engine";
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
  orderMaterialEffectsOperation,
  validateExtendedTaskOperation,
  validateRepeatAttemptOperation,
} from "./task-operations.js";

export * from "./action-operation.js";
export * from "./mechanics.js";
export * from "./model.js";
export * from "./state-operations.js";
export * from "./task-operations.js";

export const referenceRuleset: Ruleset = {
  identity: { id: "reference-rules", version: "0.2.0" },
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
        id: "tasks",
        domainId: "rules",
        description:
          "Meaningful staging and retry validation for extended or repeated work.",
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
    validateExtendedTaskOperation,
    validateRepeatAttemptOperation,
    orderMaterialEffectsOperation,
  ],
  eventTypes: [
    actionResolvedEventType,
    concessionRecordedEventType,
    skillCreatedEventType,
    stressRecoveredEventType,
  ],
};
