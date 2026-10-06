import { describe, expect, it } from "vitest";
import {
  compileNarrationDirective,
  deriveSceneRegister,
  narrationProfileSchema,
  validateModelPrompt,
} from "@llm-ttrpg/engine";
import { groundedDramaticPresentation } from "@llm-ttrpg/reference-game";

describe("narration presentation contract", () => {
  it("compiles deterministic protected guidance and selects one scene exemplar", () => {
    const register = deriveSceneRegister({
      kind: "immediate-danger",
      actionPressure: 9,
      authorizedHorizonMs: 5_000,
      elapsedMs: 2_000,
    });
    const first = compileNarrationDirective(
      groundedDramaticPresentation.narrationProfile,
      register,
    );
    const second = compileNarrationDirective(
      groundedDramaticPresentation.narrationProfile,
      register,
    );

    expect(first).toEqual(second);
    expect(first.sceneRegister).toEqual(expect.objectContaining({
      pacing: "immediate",
      timeCompression: "none",
      spatialClarity: "high",
    }));
    expect(first.selectedExemplarIds).toEqual(["awakening-earth.example.danger"]);
    expect(first.protectedContext).toContain("contemporary modern Earth");
    expect(first.protectedContext).toContain("Do not invent an object, route, hazard");
    expect(first.protectedContext).not.toContain("By late afternoon");
  });

  it("rejects a package profile that authorizes narrator-owned player choices", () => {
    expect(() => narrationProfileSchema.parse({
      ...groundedDramaticPresentation.narrationProfile,
      playerAgency: {
        ...groundedDramaticPresentation.narrationProfile.playerAgency,
        inventVoluntaryActions: true,
      },
    })).toThrow();
  });

  it("keeps protected guidance distinct from ordinary context", () => {
    const prompt = validateModelPrompt({
      protectedContext: ["authoritative narration contract"],
      instructions: ["Render committed outcomes."],
      context: "ordinary actor-visible context",
      input: "committed public result",
    });
    expect(prompt.protectedContext).toEqual(["authoritative narration contract"]);
    expect(prompt.context).toBe("ordinary actor-visible context");
  });
});
