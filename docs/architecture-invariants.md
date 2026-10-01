# Architecture Invariants

These are project-level constraints. Implementation should work within them unless we explicitly decide to revise the architecture.

## Authority

- The simulation and database are authoritative.
- The LLM never directly rewrites canonical world state.
- The LLM may interpret intent, choose relevant operations/checks, reason about NPC intentions, and narrate outcomes.
- State changes must pass through deterministic engine operations that can validate or reject them.

## Game packages

- The engine knows how to run a game; it does not contain the rules or setting of a specific game.
- A game definition composes exactly one ruleset, setting, pair-specific setting adapter, campaign, and presentation configuration.
- Rulesets define mechanics. Settings define reusable fictional truth. Adapters translate one specific setting/ruleset pair. Campaigns define starting content. World State owns mutable reality after initialization.
- Presentation guidance can shape narration and UI language but cannot determine truth or outcomes.
- The engine package must never import the reference-game package.
- Establish these seams while building the reference game; do not build a marketplace, public mod SDK, or dynamic third-party loader before a real second game requires one.

## World operations

- Expose reusable world operations rather than scenario-specific scripted actions.
- Tool access is progressively disclosed.
- The conceptual hierarchy is at least **domain → subsystem → operation**.
- These are application-level tool trees. They are **not literal MCP servers**, and there is no plan to convert them into MCP servers.
- Rules operations use the same hierarchy. They expose schemas and deterministic implementations, then return outcomes and proposed mutations/events instead of directly mutating persistence.

## Persistence and application boundaries

- React is presentation and does not own canonical World State, execute rules, or issue SQL.
- The headless engine owns domain-oriented persistence ports and the logical unit of work. Desktop code supplies the SQLite adapter.
- A canonical change is exposed only after validation, deterministic application, and atomic persistence succeed.
- A world is a stable campaign lineage. A world can have many immutable checkpoints.
- Friendly save slots are mutable pointers to checkpoints. Saving to an existing slot creates a new checkpoint and moves only the pointer.
- The Rust/Tauri layer remains a thin native host for startup, plugin setup, and migrations; it is not a game backend.

## Context and knowledge

- The LLM should receive a small always-present rules/context layer plus selectively retrieved information.
- It should not receive the entire world database.
- NPC ignorance and player ignorance should be enforced by available context, not merely requested in a prompt.
- Relevant memories, facts, world events, and operations should be retrieved based on the current situation and perspective.

## Campaign planning

- The LLM may maintain a persistent, revisable GM plan at linked high, medium, and low horizons.
- Campaign-plan state is hidden and non-authoritative. It is not World State, event history, an actor/group belief, or immutable campaign source content.
- Plans may guide attention, pacing, context selection, and development of established situations. They cannot establish events, mutate reality, override simulation, or make an NPC act.
- Plan situations and pressures, never required player actions or solutions. The campaign may diverge completely from an initially imagined climax or ending.
- Planned developments remain conditional until they resolve through normal world/rules operations and are recorded as canonical state/events.
- Replan from the lowest affected horizon upward. Trivial actions should not cause expensive full-campaign planning passes.
- Player-created goals are first-class planning input. Repeatedly ignored threads may diminish or disappear.
- Planner input must come from current state/history, NPC/faction goals, campaign content, player behavior/interests, and presentation/storytelling guidance.
- GM-plan context must never leak into ordinary player/NPC perspectives or become a back door for canonical mutation.

## Time

- Time is fictional game time, not wall-clock time.
- The world does not continuously tick every simulated object.
- Off-screen systems sleep and catch up when they become relevant.
- Meaningful events form a causal history that can drive later catch-up and retrieval.

## Action scope

- Do not divide play into a simple combat / non-combat binary.
- Use **action pressure** to constrain how much fictional time and action scope the player may describe at once.
- Low pressure permits broad intentions over long spans.
- High pressure permits only very short, immediate actions.

## Presentation

- The first version is text-first.
- Graphics are presentation only and never authoritative state.
- Portraits, backgrounds, maps, and generated scene art can be layered on later without changing the simulation model.

## Development

- Work should be organized into coherent Codex-sized capability slices, not tiny human-sized tickets.
- Each slice should have observable acceptance scenarios and clear boundaries.
- Prefer a working vertical slice over premature breadth.
