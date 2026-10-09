import { describe, expect, it } from "vitest";
import {
  buildPresentationBeat, composeNpcReplies, deterministicBeatFallback,
  observableActionOutcomes, observableEventSummaries,
  validatePresentedText,
  compileNarrationDirective, deriveSceneRegister,
  type CommittedOperationReceipt, type CanonicalEvent,
} from "@llm-ttrpg/engine";
import { groundedDramaticPresentation } from "@llm-ttrpg/reference-game";

const actorId = "campaign.entity.amelia";
const scene = {
  schemaVersion: 1 as const,
  sceneBrief: JSON.stringify({
    situation: { locationRef: "scene.store",
      scene: [{ localRef: "scene.store", displayIdentity: "Corner Store" }] },
  }),
  worldRevision: 8, eventSequence: 22,
};
const base = {
  id: "action.test.beat", kind: "action" as const,
  scene, declaration: "I open the drawer.",
  observableOutcomes: ["The attempted action succeeded according to the committed rules result."],
  elapsedMs: 1_000,
};

describe("LM-12 committed presentation beats", () => {
  it("keeps canonical identity and source revision in an engine-only sidecar", () => {
    const beat = buildPresentationBeat(base);
    expect(beat.basis).toEqual({ id: "action.test.beat", worldRevision: 8, eventSequence: 22 });
    expect(JSON.parse(beat.modelText)).toMatchObject({
      scene: { situation: { locationRef: "scene.store" } },
      observableOutcomes: base.observableOutcomes,
      elapsedMs: 1_000,
    });
    expect(beat.modelText).not.toContain("action.test.beat");
    expect(beat.modelText).not.toContain('"worldRevision"');
    expect(beat.modelText).not.toContain('"eventSequence"');
  });

  it("survives a committed routine operation with no material event", () => {
    const receipt = {
      toolId: "rules.actions.complete-routine-task",
      result: { actorId, actionSummary: "I sit down." },
      events: [], advanceTimeByMs: 500,
    } as unknown as CommittedOperationReceipt;
    const outcomes = observableActionOutcomes({
      receipts: [receipt], authorizedEntityIds: [], playerActorId: actorId,
    });
    expect(outcomes[0]).toContain("I sit down");
    const beat = buildPresentationBeat({
      ...base, declaration: "I sit down.", observableOutcomes: outcomes, elapsedMs: 500,
    });
    expect(deterministicBeatFallback(beat)).toBe("You sit down.");
  });

  it("does not leak off-scene public or explicitly private events through a receipt", () => {
    function event(id: string, access: "public" | "gm-only", related: string[]): CanonicalEvent {
      return {
        id, access, relatedEntityIds: related, scopeIds: [],
        summary: id,
      } as unknown as CanonicalEvent;
    }
    const events = [
      event("VISIBLE_ACTOR_CONSEQUENCE", "public", [actorId]),
      event("PUBLIC_BUT_OFFSCREEN_SECRET", "public", ["npc.elsewhere"]),
      event("GM_ONLY_SECRET", "gm-only", [actorId]),
    ];
    const receipt = {
      toolId: "test.actions.resolve-effort",
      result: { success: false, internalSecret: "HIDDEN_RAW_RESULT" },
      events, advanceTimeByMs: 1_000,
    } as unknown as CommittedOperationReceipt;
    const lines = observableActionOutcomes({
      receipts: [receipt], authorizedEntityIds: [],
      playerActorId: actorId,
    });
    expect(lines.join(" ")).toContain("VISIBLE_ACTOR_CONSEQUENCE");
    expect(lines.join(" ")).toContain("did not succeed");
    expect(lines.join(" ")).not.toContain("PUBLIC_BUT_OFFSCREEN_SECRET");
    expect(lines.join(" ")).not.toContain("GM_ONLY_SECRET");
    expect(lines.join(" ")).not.toContain("HIDDEN_RAW_RESULT");
    expect(observableEventSummaries(events, [actorId]))
      .toEqual(["VISIBLE_ACTOR_CONSEQUENCE"]);
  });

  it("rejects invented player choices, a new usable exit and rewritten quotes", () => {
    const beat = buildPresentationBeat({
      ...base, kind: "conversation",
      declaration: 'I say "No, not today."',
      quotedSpeech: ["No, not today."],
    });
    expect(validatePresentedText('You say "No, not today."', beat).ok).toBe(true);
    expect(validatePresentedText("You say no.", beat)).toMatchObject({
      ok: false, reason: "missing-verbatim-quote",
    });
    expect(validatePresentedText('You decide to leave. "No, not today."', beat)).toMatchObject({
      ok: false, reason: "invented-player-agency",
    });
    expect(validatePresentedText('You see an unlocked exit. "No, not today."', beat)).toMatchObject({
      ok: false, reason: "ungrounded-actionable-detail",
    });
    expect(validatePresentedText(" ", beat)).toMatchObject({ ok: false, reason: "empty" });
  });

  it("composes multiple direct NPC lines without altering speaker order or words", () => {
    expect(composeNpcReplies([
      { speaker: "Mara", speech: "No, it's closed." },
      { speaker: "Nina", speech: "I saw it too.", visibleManner: "glances aside" },
    ])).toBe('Mara: "No, it\'s closed."\nNina: "I saw it too." (glances aside)');
  });

  it("keeps swappable style directives compact while retaining hard agency rules", () => {
    const profile = groundedDramaticPresentation.narrationProfile;
    const directive = compileNarrationDirective(profile, deriveSceneRegister({
      kind: "immediate-danger", actionPressure: 9,
      authorizedHorizonMs: 5_000, elapsedMs: 1_000,
    }));
    expect(directive.protectedContext).toContain("Do not invent an object, route, hazard");
    expect(directive.protectedContext).toContain("contemporary modern Earth");
    expect(directive.protectedContext).not.toContain("awakening-earth.example.conversation");
    const alternative = compileNarrationDirective({
      ...profile,
      voice: { ...profile.voice, diction: "Formal epic fantasy verse." },
    }, deriveSceneRegister({
      kind: "action", actionPressure: 4, authorizedHorizonMs: 10_000,
      elapsedMs: 1_000,
    }));
    expect(alternative.protectedContext).toContain("Formal epic fantasy verse.");
    expect(alternative.protectedContext).not.toContain("Clear contemporary language");
  });
});
