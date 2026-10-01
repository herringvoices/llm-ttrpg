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
- A resolution operation is a rules operation, not a separate check registry. The engine recognizes only the generic resolution paths `automatic`, `impossible`, and `uncertain`; checks and their mechanics remain ruleset-owned.
- Resolution assessment is deterministic and has no RNG capability. Only the second phase of an `uncertain` resolution may receive lazy engine RNG access, and uncertainty does not require using it.
- Ruleset-owned resolution basis and results remain opaque validated data. The engine has no universal difficulty, modifier, opposition, success, or degree semantics.
- `impossible` is a valid local fictional resolution, distinct from an invalid request and from concluding that the player's overall goal is impossible.
- Operations receive a deep-frozen, explicitly enumerated rules-visible world snapshot. Engine-private RNG progression is absent; uncertain resolution receives randomness only through its explicit RNG capability. Authoritative changes can occur only through validated mutation/event proposals committed by the runtime.
- A ruleset must validate that its structured resolution input applies to the supplied executable intent. The engine does not infer actor, target, opposition, or other semantics from arbitrary ruleset fields.

## Persistence and application boundaries

- React is presentation and does not own canonical World State, execute rules, or issue SQL.
- The headless engine owns domain-oriented persistence ports and the logical unit of work. Desktop code supplies the SQLite adapter.
- A canonical change is exposed only after validation, deterministic application, and atomic persistence succeed.
- A world is a stable campaign lineage. A world can have many immutable checkpoints.
- Friendly save slots are mutable pointers to checkpoints. A checkpoint preserves current World State and a separate exact history snapshot. Saving to an existing slot creates a new checkpoint and moves only the pointer.
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

- Fictional time and wall-clock metadata use distinct types and dependencies. Wall time timestamps files/records; it never decides when a fictional event happened.
- A fictional instant is a normalized UTC ISO value. Advancement uses exact nonnegative integer millisecond durations, is deterministic, and never moves backward. Calendar presentation remains a setting/presentation concern.
- Current World State, future scheduled triggers, and historical events are distinct. A scheduled possibility is not an event until normal simulation/operation resolution makes it happen.
- Meaningful event history is append-only, separately queried, and is not an event-sourcing log. Current state remains authoritative and is not reconstructed by replaying history.
- Events have a deterministic total order by fictional instant and engine-assigned sequence. Causal references point only to prior events; execution provenance remains separate from causality.
- Active packages register versioned event payload schemas. The engine owns and validates the generic envelope without interpreting game-specific payload meaning.
- Operation code receives current state, not the world's entire historical record. Relevant history must be requested through targeted queries.
- Persist all meaningful canonical events for MVP. Do not compact or delete them before real scale evidence exists.
- Simulation cursors persist the last fictional instant at which a generic scope was brought current, and may never exceed world time.
- The world does not continuously tick every simulated object.
- Off-screen systems sleep and catch up when they become relevant.
- Meaningful events form a causal history that can drive later catch-up and retrieval.

## Action scope

- Do not divide play into a simple combat / non-combat binary.
- **Action pressure** is persisted authoritative simulation/control state, not fictional truth, a fact/belief, danger/difficulty, or a canonical event.
- The eventual LLM/orchestration layer judges pressure holistically. The engine never derives it from a deterministic count of hostiles, hazards, timers, or other facts.
- Worlds begin explicitly unassessed. The engine validates and persists an accepted level from 1 (loosest) through 9 (tightest).
- Accepted levels map deterministically to maximum resolution horizons: 8 hours, 2 hours, 30 minutes, 10 minutes, 2 minutes, 1 minute, 30 seconds, 10 seconds, and 5 seconds respectively.
- Bound executable intent preserves the player's goal and authorizes the lesser of its requested horizon and the pressure maximum. It does not split prose or substitute a different goal.
- Pressure limits fictional resolution scope, never the number of internal operations. The authorized horizon is a ceiling, not an instruction to advance time; actual operation durations consume it downstream.
- Bounding intent is side-effect free. Pressure reassessment is atomically persisted without advancing fictional time or creating an event merely for the control-state change.
- A material circumstance change returns control when it invalidates authorization assumptions or creates a meaningful new player choice. Later orchestration may then request a new assessment; it must not blindly continue or retroactively expand an existing authorization.
- A resolution request consumes an already bounded executable intent. One resolution may not advance fictional time beyond that intent's authorized horizon; issue #11 retains ownership of cumulative multi-operation budgeting and stopping.

## Randomness

- RNG progression is persisted authoritative simulation-control state, not fictional truth and not an event.
- Each world has an explicit, versioned RNG algorithm, root seed, and next local-stream index. Seeds come from an explicit host dependency, never implicitly from wall-clock time.
- A stochastic resolution uses one deterministic local stream derived from the root seed and stream index. Multiple draws stay within that stream so changing one mechanic's draw count does not shift every later resolution.
- Stream use is lazy and transactional. Invalid, automatic, impossible, and uncertain-without-draw resolutions consume no stream; a tentative draw advances authoritative progression only when the complete resolution commit succeeds.
- Completed stochastic resolutions expose an inspectable reproduction trace. Checkpoints preserve the exact RNG progression captured with the rest of execution state.

## Presentation

- The first version is text-first.
- Graphics are presentation only and never authoritative state.
- Portraits, backgrounds, maps, and generated scene art can be layered on later without changing the simulation model.

## Development

- Work should be organized into coherent Codex-sized capability slices, not tiny human-sized tickets.
- Each slice should have observable acceptance scenarios and clear boundaries.
- Prefer a working vertical slice over premature breadth.
