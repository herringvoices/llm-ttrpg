# LM-09 — Compact campaign startup (Awakening Earth reference game)

## Versioning and compatibility

New desktop generation drafts store `compactVersion: 2` inside the existing `state_json` record, not in generic engine saves. An older draft without that marker continues through the prior `generateStartingRegion` pipeline with its accepted stage IDs, checkpoints, model outputs and legacy audit. This avoids reinterpretation of partially accepted legacy records. Existing completed campaigns retain their full saved `StartingRegionSeed`, generated-package descriptor, opening progression and materialized world. Neither old saves nor old drafts are force-regenerated.

New stages reported to the progress UI: `normalize`, `compact-seed`, `expand-seed`, `compact-opening`, `finalize-seed`, then the existing optional `opening-incident` and `finalize`. The expanded full seed remains the input to `compileStartingRegionCampaign`; the compiled generation record marks the new path as `starting-region-v2`.

## Call budgeting and ownership

The *common creative startup* now takes **three structured calls**:

1. `normalize` (existing player-established facts and location constraints, with source-quotation validation).
2. `compact-seed` (region/settlement/locality names, one local place, 1–2 contact sketches, three short grounded pressures and one magical premise).
3. `compact-opening` (legal opening mode and focus, first-power target turn 1–3, observable situation, optional social/investigative/risky responses).

An accepted normalized draft skips the first call; accepted `compact-seed` survives a failed later stage, so the same creative work is not regenerated. The compact source schema contains no model-generated canonical IDs, persistence metadata, complete institutional graphs, combat mechanics, inventories or simulated history. Unlike the legacy pipeline, **the compact path has no advisory coherence-audit model call**. Production still may call the local model separately for an *actually required creature incident* and for opening narration. Model errors preserve the draft rather than committing a partial world. Actual token counts and latency should be reported from LM-01 observability; these are staged/scripted call counts, not a measured CPU performance claim.

This generator belongs to the Awakening Earth reference game, not the setting-agnostic engine. It reuses the original tested deterministic expansion helpers for grounded mundane player mechanics, small institutions, NPC social states, three categories of pressures, processes, conservative creature threat envelopes and existing workplace anchors. It then validates schema, modernity, graph connectivity, actor/pressure/route references, no-retcon input sources and opening anchors before compiling. The one connected home/starting point and public location expand only as far as immediately playable; LM-10 owns broader on-demand densification. No power is awarded in this stage.

## Narrative and safety invariants

An opening is either a supernatural inciting incident (creature or phenomenon) or a mundane activity that precedes personal manifestation. Each supplies social, investigative and risky directions, but combat and a specific quest are never required. The existing opening director counts meaningful player turns and enforces manifestation within turns 1–3; the seed must not simulate a player response.

Player-specified names, location constraints, biography and negative power guidance remain authoritative. The model cannot supply a pre-established family tie, job, commitment, belief or secret on the player's behalf. Unknown housing details remain unspecified. Real named settlements cannot be replaced without failing validation. Current settlement scale comes from the accepted normalized constraints rather than the seed proposal's guess. Contemporary roads, connectivity, services, utilities and transportation are setting fundamentals even when the requested place is rural.

## Known follow-ups

The compact path is intentionally a minimal validated starting **scaffold**. LM-10 should expand only newly relevant places/NPCs and never treat generated possibilities as already committed world events. LM-13 should compare quality on the bundled local model; deterministic and scripted tests cannot establish actual generation speed or story quality.
