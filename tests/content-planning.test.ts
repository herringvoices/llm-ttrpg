import { describe, expect, it } from "vitest";
import {
  assessSituationCandidateGrounding,
  committedDetailEstablishingReferences,
  contentPlanningMaterialSchema,
  createAuthoritativeGroundingCatalog,
  initializeCampaignHistory,
  initializeCampaignWorld,
  loadGameDefinition,
  worldStateSchema,
} from "@llm-ttrpg/engine";
import {
  BROWNBAG_IDS,
  buildBrownbagSituationMaterial,
  referenceGameDefinition,
} from "@llm-ttrpg/reference-game";

describe("non-authoritative content-planning contracts", () => {
  it("resolves grounding without turning planning material into World State", () => {
    const game = loadGameDefinition(referenceGameDefinition);
    const world = initializeCampaignWorld(game, 0x2600_0026);
    const history = initializeCampaignHistory(game);
    const material = buildBrownbagSituationMaterial(world);
    const catalog = createAuthoritativeGroundingCatalog(world, history);

    for (const candidate of material.candidates) {
      expect(assessSituationCandidateGrounding(candidate, material, catalog))
        .toEqual(expect.objectContaining({ grounded: true, issues: [] }));
    }
    const missing = {
      ...material.candidates[0]!,
      grounding: [{ kind: "fact" as const, id: "missing.fact" }],
    };
    expect(assessSituationCandidateGrounding(missing, material, catalog))
      .toEqual(expect.objectContaining({
        grounded: false,
        issues: [expect.objectContaining({ code: "content.grounding.missing" })],
      }));

    expect(worldStateSchema.safeParse({
      ...world,
      contentPlanningMaterial: material,
    }).success).toBe(false);
    expect(JSON.stringify(world)).not.toContain(BROWNBAG_IDS.socialDetail);
  });

  it("accepts commitment evidence only when the asserted canonical value exists", () => {
    const game = loadGameDefinition(referenceGameDefinition);
    const world = initializeCampaignWorld(game, 0x2600_0027);
    const material = buildBrownbagSituationMaterial(world);
    const catalog = createAuthoritativeGroundingCatalog(
      world,
      initializeCampaignHistory(game),
    );
    const detail = material.provisionalDetails.find((item) =>
      item.id === BROWNBAG_IDS.freezerDetail
    )!;
    const falseEvidence = contentPlanningMaterialSchema.parse({
      ...material,
      commitmentEvidence: [{
        detailId: detail.id,
        assertions: [{
          reference: {
            kind: "entity",
            id: BROWNBAG_IDS.store,
            path: ["data", "equipment", "refrigeration", "age-band"],
          },
          expectedValue: "new",
        }],
      }],
    });
    expect(committedDetailEstablishingReferences(
      detail.id,
      falseEvidence,
      catalog,
    )).toEqual([]);

    const trueEvidence = contentPlanningMaterialSchema.parse({
      ...material,
      commitmentEvidence: [{
        detailId: detail.id,
        assertions: [{
          reference: {
            kind: "entity",
            id: BROWNBAG_IDS.store,
            path: ["data", "equipment", "refrigeration", "age-band"],
          },
          expectedValue: "aging",
        }],
      }],
    });
    expect(committedDetailEstablishingReferences(
      detail.id,
      trueEvidence,
      catalog,
    )).toEqual([expect.objectContaining({
      kind: "entity",
      id: BROWNBAG_IDS.store,
    })]);
  });
});
