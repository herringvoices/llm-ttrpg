import {
  type ModelRuntime,
} from "@llm-ttrpg/engine";
import { z } from "zod";
import {
  firstPowerProposalSchema,
  normalizedPlayerSetupSchema,
  validateFirstPowerProposal,
} from "./player-creation.js";
import {
  powerStateSchema,
  powerTagSchema,
  type PowerState,
} from "./ruleset/model.js";
import {
  awakeningEarthPowerTagVocabulary,
  retrievePowerExemplars,
} from "./powers.js";

export const powerGenerationRequestSchema = z.object({
  characterSummary: z.string().trim().min(1),
  normalizedSetup: normalizedPlayerSetupSchema,
  characterLevelAtManifestation: z.number().int().positive(),
  initialPowerPoints: z.number().int().nonnegative(),
  firstPower: z.boolean(),
  suggestedTags: z.array(powerTagSchema).default([]),
  existingPowers: z.array(powerStateSchema).default([]),
}).strict().superRefine((request, context) => {
  if (
    request.firstPower &&
    (
      request.characterLevelAtManifestation !== 1 ||
      request.initialPowerPoints !== 5 ||
      request.existingPowers.length !== 0
    )
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "An Awakening Earth first-power request must be Level 1, use 5 PP, and have no existing powers",
    });
  }
});
export type PowerGenerationRequest = z.infer<typeof powerGenerationRequestSchema>;

export type GeneratedPowerProposal = z.infer<typeof firstPowerProposalSchema>;

function normalized(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function validateGeneratedPowerProposal(
  requestValue: unknown,
  proposalValue: unknown,
): GeneratedPowerProposal {
  const request = powerGenerationRequestSchema.parse(requestValue);
  const proposal = firstPowerProposalSchema.parse(proposalValue);
  const expectedStrength =
    1 + Math.floor(request.characterLevelAtManifestation / 2);

  if (
    proposal.power.characterLevelAtManifestation !==
      request.characterLevelAtManifestation ||
    proposal.power.manifestationStrength !== expectedStrength ||
    proposal.power.pp !== request.initialPowerPoints
  ) {
    throw new Error(
      "Generated power does not match the requested manifestation level, strength, and PP budget",
    );
  }
  if (proposal.power.tags.length === 0) {
    throw new Error("Generated powers must include semantic tags");
  }
  if (!proposal.negativeConstraintsRespected) {
    throw new Error("Generated power violated a hard negative preference");
  }

  const duplicate = request.existingPowers.find((existing) =>
    existing.id === proposal.power.id ||
    normalized(existing.name) === normalized(proposal.power.name) ||
    normalized(existing.corePrinciple) === normalized(proposal.power.corePrinciple)
  );
  if (duplicate) {
    throw new Error(
      `Generated power duplicates existing power ${duplicate.name}`,
    );
  }

  if (request.firstPower) {
    return validateFirstPowerProposal(proposal);
  }
  return proposal;
}

function compactPower(power: PowerState) {
  return {
    id: power.id,
    name: power.name,
    corePrinciple: power.corePrinciple,
    manifestationStrength: power.manifestationStrength,
    growthProfile: power.growthProfile,
    functions: power.functions,
    developmentAxes: power.developmentAxes,
    tags: power.tags,
  };
}

function generationSearchText(request: PowerGenerationRequest): string {
  return [
    request.characterSummary,
    ...request.normalizedSetup.currentWants,
    ...request.normalizedSetup.powerPreferences.positive.map(
      (preference) => preference.description,
    ),
  ].join(" ");
}

export function createPowerProposalModel(modelRuntime: ModelRuntime) {
  return {
    async propose(requestValue: unknown): Promise<GeneratedPowerProposal> {
      const request = powerGenerationRequestSchema.parse(requestValue);
      const exemplars = retrievePowerExemplars({
        tags: request.suggestedTags,
        text: generationSearchText(request),
        limit: 6,
        excludePowerIds: request.existingPowers.map((power) => power.id),
      });
      const result = await modelRuntime.generate({
        prompt: {
          protectedContext: [
            "The simulation/rules state is authoritative. You are proposing a power for deterministic validation, not declaring that it exists.",
          ],
          instructions: [
            "Design one Awakening Earth power as an individualized supernatural rule, not as a class or spell-list choice.",
            "The provided exemplar powers and tag vocabulary are illustrative and explicitly non-exhaustive. You may invent a power and new semantic tags that are absent from both.",
            "Use retrieved exemplars as precedents for shape, scope, specificity, and limits. Do not merely rename, reskin, or combine them.",
            "Keep one coherent supernatural principle. Do not bundle several unrelated abilities under a broad theme.",
            "Plain powers are valid. A simple ranged attack, melee enhancement, movement effect, or utility rule can be a better answer than an elaborate conceptual power.",
            "A first player power may not be a raw stat-enhancement power. Do not use the role.stat-enhancement tag for the first player power.",
            "A power may be modest alone and become valuable through experimentation or synergy with other powers.",
            "Specify only currently manifested functions. Do not pre-generate a complete late-game tree.",
            "Use exact costs, activation conditions, targets, limits, and scaling formulas wherever the current function needs them.",
            "Use semantic tags for retrieval, but do not treat tags as exhaustive categories.",
            "Respect all negative power preferences as hard constraints and report that in negativeConstraintsRespected.",
          ],
          context: JSON.stringify({
            request: {
              characterSummary: request.characterSummary,
              characterLevelAtManifestation:
                request.characterLevelAtManifestation,
              manifestationStrength:
                1 + Math.floor(request.characterLevelAtManifestation / 2),
              initialPowerPoints: request.initialPowerPoints,
              firstPower: request.firstPower,
              suggestedTags: request.suggestedTags,
            },
            player: {
              establishedFacts: request.normalizedSetup.establishedFacts,
              currentWants: request.normalizedSetup.currentWants,
              powerPreferences: request.normalizedSetup.powerPreferences,
            },
            existingPowers: request.existingPowers.map(compactPower),
            nonExhaustiveKnownTags: awakeningEarthPowerTagVocabulary,
            illustrativeExemplars: exemplars.map(compactPower),
          }),
          input:
            "Propose one structured power that fits this character, this manifestation budget, and Awakening Earth.",
        },
        output: {
          kind: "structured",
          schemaId: "awakening-earth.power-proposal.v1",
          schema: firstPowerProposalSchema,
        },
        trace: { operation: "reference-game.generate-power" },
      }, {
        timeoutMs: 2 * 60 * 1_000,
        generation: { temperature: 0.7, maxOutputTokens: 2_048 },
      });

      if (!result.ok) {
        throw new Error(
          `Power generation failed: ${result.error.kind}: ${result.error.message}`,
        );
      }
      return validateGeneratedPowerProposal(request, result.output.value);
    },
  };
}

export function firstPowerGenerationRequest(
  input: {
    readonly characterSummary: string;
    readonly normalizedSetup: z.infer<typeof normalizedPlayerSetupSchema>;
    readonly suggestedTags?: readonly string[];
  },
): PowerGenerationRequest {
  return powerGenerationRequestSchema.parse({
    characterSummary: input.characterSummary,
    normalizedSetup: input.normalizedSetup,
    characterLevelAtManifestation: 1,
    initialPowerPoints: 5,
    firstPower: true,
    suggestedTags: input.suggestedTags ?? [],
    existingPowers: [],
  });
}
