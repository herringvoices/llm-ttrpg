# Narration & Presentation

**Status:** Canonical implementation contract for Issue #39.

Narration is downstream of authority. It renders actor-visible context and committed outcomes; it never determines success, NPC decisions, fictional time, world state, or campaign direction. A failed narration call may be retried without replaying mechanics.

## Package ownership

Every presentation component supplies a validated, versioned `NarrationProfile`. The engine owns the generic schema and deterministic compilation path, while each game package owns its voice, viewpoint, examples, and descriptive priorities. Core orchestration contains no Awakening Earth prose rules.

The profile records:

- person, tense, and camera;
- explicit player-agency and knowledge boundaries;
- voice, diction, humor, and things to avoid;
- sensory, exposition, environmental, and spatial guidance;
- dialogue rendering rules;
- the authority boundary between transient color and actionable facts;
- short package-authored exemplars keyed by scene kind.

Awakening Earth uses second-person present tense, a player-limited camera, grounded contemporary diction, restrained exposition, clear danger, and mundane modern detail that contrasts with supernatural strangeness.

## Protected context

`ModelPrompt.protectedContext` is distinct from ordinary actor-visible context. Provider adapters place protected material first and label it as non-overridable. Context assembly and transcript growth do not trim it. If a provider cannot fit both the protected contract and the minimum authoritative input, it must return a visible context-size failure rather than silently omit the contract.

Narration requests compile the stable profile deterministically. All stable fields are included; one relevant exemplar is selected deterministically by scene kind. Exemplars are style guidance, not world facts.

## Scene Register

Each narration request derives a non-authoritative `SceneRegister` from known data:

- scene kind;
- current Action Pressure, including an honest `unassessed` state for an opening;
- authorized fictional horizon;
- committed elapsed time;
- pacing and time-compression policy;
- spatial-clarity level;
- descriptive priorities.

High pressure produces immediate pacing, no time compression, and high spatial clarity. Low-pressure long-horizon work may be compressed around discoveries, decisions, and material changes. These directives change prose only; they never change the committed outcome or elapsed time. Concise / Standard / Expansive remains an independent length preference.

## Unified player-facing paths

The same profile/scene-register compiler is used by:

- opening narration;
- ordinary player-action narration;
- post-commit action narration retry;
- conversation final prose.

Catch-up currently presents deterministic state changes and does not have a separate LLM prose call. Any future player-facing catch-up prose must use this same boundary.

## Agency, knowledge, and affordances

The narrator may describe only authorized player behavior, observable NPC behavior, and player-visible committed consequences. It must not reveal private NPC cognition, hidden canonical facts, campaign-plan state, rejected proposals, or raw identifiers.

It does not invent the player character's dialogue, voluntary actions, decisions, beliefs, conclusions, intentions, thoughts, feelings, or emotional reactions. Grounded involuntary physical consequences may be described when supplied by committed state/outcomes.

Transient sensory color is allowed only when it creates no durable fact or reasonable future interaction. An object, route, hazard, witness, resource, clue, or causal fact that a player could reasonably use next must already exist in authorized scene context. Narration never retroactively makes an invented detail canonical.

## Diagnostics

Action traces and conversation diagnostics expose the presentation component/profile identity and version, protected-guidance inclusion, compiled size, selected exemplar, Scene Register, and source categories. Full prompts are not canonical events and narration guidance is never copied into world history.
