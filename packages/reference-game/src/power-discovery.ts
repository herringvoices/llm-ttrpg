import { type ModelRuntime } from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  powerDiscoveredBehaviorSchema,
  powerStateSchema,
  type PowerState,
} from "./ruleset/model.js";

export const powerExperimentConclusionSchema = z.enum([
  "already-specified",
  "valid-implication",
  "invalid-implication",
  "check-required",
  "new-canonical-edge-behavior",
]);
export type PowerExperimentConclusion = z.infer<
  typeof powerExperimentConclusionSchema
>;

export const powerExperimentRequestSchema = z.object({
  power: powerStateSchema,
  attemptedAction: z.string().trim().min(1),
  worldContext: z.string().trim().min(1),
  applicableRules: z.array(z.string().trim().min(1)).default([]),
}).strict();
export type PowerExperimentRequest = z.infer<typeof powerExperimentRequestSchema>;

export const powerExperimentAdjudicationSchema = z.object({
  powerId: z.string().trim().min(1),
  conclusion: powerExperimentConclusionSchema,
  rationale: z.string().trim().min(1),
  requiredCheck: z.string().trim().min(1).optional(),
  newBehavior: powerDiscoveredBehaviorSchema.optional(),
}).strict().superRefine((proposal, context) => {
  if (
    proposal.conclusion === "new-canonical-edge-behavior" &&
    !proposal.newBehavior
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "A new canonical edge behavior conclusion requires a structured newBehavior",
      path: ["newBehavior"],
    });
  }
  if (
    proposal.conclusion !== "new-canonical-edge-behavior" &&
    proposal.newBehavior
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Only a new canonical edge behavior conclusion may include newBehavior",
      path: ["newBehavior"],
    });
  }
  if (
    proposal.conclusion === "check-required" &&
    !proposal.requiredCheck
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A check-required conclusion must identify the required check",
      path: ["requiredCheck"],
    });
  }
});
export type PowerExperimentAdjudication = z.infer<
  typeof powerExperimentAdjudicationSchema
>;

export function validatePowerExperimentAdjudication(
  requestValue: unknown,
  proposalValue: unknown,
): PowerExperimentAdjudication {
  const request = powerExperimentRequestSchema.parse(requestValue);
  const proposal = powerExperimentAdjudicationSchema.parse(proposalValue);
  if (proposal.powerId !== request.power.id) {
    throw new Error(
      `Power experiment ruling targets ${proposal.powerId}, expected ${request.power.id}`,
    );
  }
  if (
    proposal.newBehavior &&
    request.power.discoveredBehaviors.some(
      (behavior) => behavior.id === proposal.newBehavior!.id,
    )
  ) {
    throw new Error(
      `Power behavior ${proposal.newBehavior.id} is already established`,
    );
  }
  return proposal;
}

export function applyPowerExperimentAdjudication(
  requestValue: unknown,
  proposalValue: unknown,
): PowerState {
  const request = powerExperimentRequestSchema.parse(requestValue);
  const proposal = validatePowerExperimentAdjudication(request, proposalValue);
  if (!proposal.newBehavior) return request.power;
  return powerStateSchema.parse({
    ...request.power,
    discoveredBehaviors: [
      ...request.power.discoveredBehaviors,
      proposal.newBehavior,
    ],
  });
}

export function createPowerExperimentProposalModel(modelRuntime: ModelRuntime) {
  return {
    async propose(requestValue: unknown): Promise<PowerExperimentAdjudication> {
      const request = powerExperimentRequestSchema.parse(requestValue);
      const result = await modelRuntime.generate({
        prompt: {
          protectedContext: [
            "The power definition and previously discovered behaviors are authoritative. Narration cannot add capabilities.",
          ],
          instructions: [
            "Adjudicate one attempted use or experiment against the existing supernatural rule.",
            "Prefer an already established rule when one clearly answers the question.",
            "A valid implication must follow from the current core principle and manifested functions; it cannot smuggle in a new unrelated capability.",
            "An invalid implication conflicts with an established principle, condition, target, limit, or discovered behavior.",
            "Use check-required when the power permits the attempt but ordinary uncertainty or rules mechanics must determine success.",
            "Use new-canonical-edge-behavior only when the power permits the question but existing authoritative state does not settle a reusable rule.",
            "Do not answer philosophical or metaphysical questions that the current attempted action does not require the simulation to settle.",
            "A newBehavior must state the narrowest reusable ruling necessary for future consistency.",
          ],
          context: JSON.stringify({
            power: request.power,
            attemptedAction: request.attemptedAction,
            worldContext: request.worldContext,
            applicableRules: request.applicableRules,
          }),
          input:
            "Classify the experiment and provide the smallest authoritative ruling needed for this attempted action.",
        },
        output: {
          kind: "structured",
          schemaId: "awakening-earth.power-experiment.v1",
          schema: powerExperimentAdjudicationSchema,
        },
        trace: { operation: "reference-game.adjudicate-power" },
      }, {
        timeoutMs: 2 * 60 * 1_000,
        generation: { temperature: 0.2, maxOutputTokens: 1_024 },
      });

      if (!result.ok) {
        throw new Error(
          `Power adjudication failed: ${result.error.kind}: ${result.error.message}`,
        );
      }
      return validatePowerExperimentAdjudication(request, result.output.value);
    },
  };
}
