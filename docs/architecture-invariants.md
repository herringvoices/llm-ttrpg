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
- Tool access is progressively disclosed through **domain → subsystem → concise tool → detailed contract**. Listing a branch does not dump every schema.
- These are application-level tool trees. They are **not literal MCP servers**, and there is no plan to convert them into MCP servers.
- The authoritative operation registry and the model-facing tool catalog are distinct. The registry owns complete executable rules operations and runtime schemas; the catalog is a filtered documentation/binding projection over real registered capabilities.
- A catalog tool need not be a rules operation. Deterministic read-only engine queries can participate through a separate validated backend binding without pretending to be game mechanics.
- Potential tools and explicit domain/subsystem descriptions are assembled at game-composition time. The engine defines no universal domain taxonomy.
- Tool availability is an authoritative policy decision applied to listing, inspection, and binding resolution. Prior disclosure is not authorization: an available registered tool may be addressed directly, while a guessed unavailable tool remains unusable.
- Catalog discovery results never expose callbacks, persistence handles, RNG internals, or private registry/state objects. Detailed inspection derives JSON-compatible schema documentation from authoritative Zod schemas.
- The catalog does not define player, NPC, or GM perspective semantics; issue #10 supplies those policies. Issue #11 later selects and executes catalog bindings through their real validated backend paths.
- Rules operations use the same hierarchy. They expose schemas and deterministic implementations, then return outcomes and proposed mutations/events instead of directly mutating persistence.
- A resolution operation is a rules operation, not a separate check registry. The engine recognizes only the generic resolution paths `automatic`, `impossible`, and `uncertain`; checks and their mechanics remain ruleset-owned.
- Resolution assessment is deterministic and has no RNG capability. Only the second phase of an `uncertain` resolution may receive lazy engine RNG access, and uncertainty does not require using it.
- Ruleset-owned resolution basis and results remain opaque validated data. The engine has no universal difficulty, modifier, opposition, success, or degree semantics.
- `impossible` is a valid local fictional resolution, distinct from an invalid request and from concluding that the player's overall goal is impossible.
- Operations receive a deep-frozen, explicitly enumerated rules-visible world snapshot. Engine-private RNG progression is absent; uncertain resolution receives randomness only through its explicit RNG capability. Authoritative changes can occur only through validated mutation/event proposals committed by the runtime.
- A ruleset must validate that its structured resolution input applies to the supplied executable intent. The engine does not infer actor, target, opposition, or other semantics from arbitrary ruleset fields.
- The first concrete reference rules implement Performance versus Resistance, attributes, open-ended skills, Effect, stress, statuses, learning evidence, and recovery entirely inside `packages/reference-game`. These types and formulas must not migrate into generic engine contracts.
- The reference rules use one operation model across calm, social, environmental, competitive, and dangerous action. Combat rounds, initiative, action points, universal reactions, and combat-specific resolution are not architectural primitives.
- Orchestration may propose semantic applicability, scope, Potential Effect, and skill specificity. The ruleset owns deterministic calculation/classification and validates proposals; narration cannot revise the result after resolution.

## Persistence and application boundaries

- React is presentation and does not own canonical World State, execute rules, or issue SQL.
- The headless engine owns domain-oriented persistence ports and the logical unit of work. Desktop code supplies the SQLite adapter.
- A canonical change is exposed only after validation, deterministic application, and atomic persistence succeed.
- A world is a stable campaign lineage. A world can have many immutable checkpoints.
- Friendly save slots are mutable pointers to checkpoints. A checkpoint preserves current World State and a separate exact history snapshot. Saving to an existing slot creates a new checkpoint and moves only the pointer.
- The Rust/Tauri layer remains a thin native host for startup, plugin setup, and migrations; it is not a game backend.

## Context and knowledge

- Model role (`actor`, `orchestrator`, `planner`, or `debug`) and knowledge perspective are separate access dimensions. Actor calls cannot use canonical perspective as an omniscience shortcut.
- Every context package separates a tiny authority/composition bootstrap, a freshly derived automatic situation frame, and progressively retrieved material. The full world, history, ruleset, and tool catalog are never dumped automatically.
- The scene manifest and context-local working references are disposable projections, not persisted canonical state. Rebuild them from current authoritative sources after meaningful changes.
- NPC ignorance and player ignorance are enforced by access filtering and perspective-safe identity projection, not merely requested in prose. Model-facing local references must not reveal canonical identity.
- Orchestration may receive tightly scoped latent scene truth with explicit actor-awareness, identity-recognition, discovery, access, and provenance metadata. Privileged role is not permission to dump the canonical database.
- Access is checked before relevance. Retrieved facts, beliefs, documents, event history, scene details, tools, and future plan fragments use validated paths and contextual policy; guessed IDs do not bypass authorization.
- Context budgets and salience ordering are deterministic and inspectable. Required current constraints remain, prominent/current-task material outranks ambient detail, and detail is reduced before existence where practical.
- Context assembly, retrieval, compression, and rendering are read-only. They cannot mutate state, advance time, append events, consume RNG, change pressure, or alter beliefs.
- Plan material is protected from actor/NPC roles and remains visibly non-authoritative even when supplied to orchestration/planning context.

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
