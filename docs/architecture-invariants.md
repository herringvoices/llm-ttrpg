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
- The catalog does not define player, NPC, or GM perspective semantics; issue #10 supplies those policies. The player-action pipeline selects and executes catalog bindings through their real validated backend paths.
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

## NPC state and mechanical realization

- Persistent NPC social/intentional state and mechanical character-sheet realization are separate axes.
- World/social resolution may progress from statistical population to ephemeral person to identified person to persistent simulation actor without requiring a complete rules profile.
- Mechanical realization may progress independently from unrealized to constrained to partial to complete.
- Persistent actor social state generically owns goals, directed relationships, episodic memories, and commitments. Identity/world facts remain ordinary entity/fact state; rules mechanics remain ruleset-owned.
- NPC knowledge reuses canonical facts plus actor/group beliefs. Do not create a parallel NPC knowledge database.
- A public fact means generally/common perspective-safe knowledge. Actor-specific observations normally become beliefs rather than globally public facts.
- Beliefs/rumors may influence actor behavior but do not constrain canonical mechanical generation unless backed by authoritative truth.
- Mechanical densification is demand-driven. Generate only the rules state required by current mechanics unless an authorized effect or coherence requirement needs a complete profile.
- Later generation may add specificity but may never contradict committed mechanics, canonical facts/observations, or prior authoritative outcomes.
- Monsters and humans may share rules primitives such as species-neutral Attributes without forcing creatures through human biography or human Character XP/power-progression semantics.
- Human/monster generation formulas, creature taxonomies, and mechanical mappings belong to the active ruleset/setting/adapter, not the generic engine.
- Mechanics-inspection abilities may legitimately trigger fuller mechanical realization before returning their validated result; ordinary narration may not fabricate a sheet.
- NPCs do not receive one simulation scope each by default. Their social state and creature growth normally participate in existing locality/household/institution/faction/etc. catch-up scopes.

## Local model runtime

- Model callers provide semantic instructions, opaque already-authorized context, semantic conversation turns, and current input. Provider message arrays and Ollama types remain adapter-private.
- Runtime output is either free text or a complete structured value validated by its authoritative Zod schema. JSON Schema may constrain provider generation but never replaces Zod validation.
- Provider-native tool calling is not the engine operation-selection contract. Models select capabilities through ordinary structured values that later orchestration resolves against the #9 catalog.
- Invalid structured output returns a normalized failure. The runtime performs no hidden repair request and exposes no partial structured JSON.
- Non-streaming generation is fundamental. Streaming is optional and text-only; cancellation and timeouts cannot produce a later actionable result.
- Runtime capabilities and diagnostics are provider-neutral. Unknown context-window sizes are not fabricated, and model lifecycle diagnostics never become canonical world events.
- #10's deterministic context budget remains provider-independent. Provider token counts/context overflow belong to transport diagnostics and do not change context selection.
- Ollama is an externally managed development service. A future bundled llama.cpp-compatible adapter/process lifecycle must fit the same semantic interface without changing gameplay contracts.
- The model runtime transports prompts/results only. It owns no authorization, state mutation, time, rules, action pressure, NPC behavior, campaign planning, or world simulation.

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

## Content and encounter development

- Situation candidates, provisional details, discovery affordances, and commitment evidence are protected non-authoritative content/planning material, not World State or event history.
- Persistent provisional detail must be validated and committed through ordinary entity, fact, belief, social-state, event, or generation boundaries before a perspective can observe it or an actor/simulation process can use it causally.
- Commitment evidence points back to the ordinary canonical records that establish a detail; it never creates a parallel truth store.
- Discovery affordances may hand orchestration only opaque local references to information authorized by the existing context/knowledge boundary. GM summaries, hidden grounding, canonical IDs, and provisional content do not cross that handoff.
- Ignoring or engaging a hook creates no special quest state. Consequences remain ordinary authoritative mutations and events, and established details remain subject to no-retcon rules.

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
- Simulation scopes are game-authored generic boundaries, not automatically one scope per entity. Parent and explicit dependency closure determine what wakes; descendants, siblings, and unrelated scopes remain asleep.
- Game packages own versioned world-process definitions and selected relevant state. The engine owns scope/process validation, deterministic DAG ordering, bounded history/schedule delivery, computation safeguards, RNG, and atomic persistence.
- Catch-up resolves a complete elapsed interval to an already-existing world time; it never advances the fictional clock or imposes minute/hour/day/week ticks.
- Later processes run against earlier proposed changes in one working snapshot. The engine does not parallelize stale outcomes or provide a universal conflict-merging layer.
- One requested dependency closure commits state, meaningful events, schedule changes, RNG progression, and cursor advancement atomically. Any failure leaves the entire closure unchanged.
- A cursor already at the target timestamp is a true no-op. Catch-up performs no model call, and an LLM cannot fabricate elapsed canonical history.

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
- A resolution request consumes an already bounded executable intent. One resolution may not advance fictional time beyond that intent's authorized horizon; the player-action pipeline owns cumulative multi-operation budgeting and stopping.
- Declaration interpretation and execution decisions are separate structured model calls. Interpretation fixes one original goal and pressure-bounded executable intent for the run; later turns may choose only one next catalog action or stop.
- There is no queued model-authored execution plan. Fresh context and a fresh decision are required after every authoritative commit, so a material circumstance change returns control instead of leaving stale future steps to run.
- Actual committed operation durations cumulatively consume the unchanged executable intent's authorization. Discovery, inspection, retrieval, rejected proposals, and model calls consume no fictional time.
- Each accepted operation, its exact time/state/event/RNG effects, and its receipt are one atomic commit. Earlier commits are never rolled back because a later proposal, model call, or narration fails.
- `ActionRun` is versioned, persistent, non-canonical orchestration and idempotency state. It is not World State, event history, campaign content, or checkpoint truth; retries reuse it and never replay committed operation effects.
- Final narration occurs only after a valid stop, from fresh actor-role context and committed actor-visible results. Narration cannot change or undo the simulation.
- A stopped action may emit a lightweight non-authoritative campaign-development signal. Campaign planning and replanning remain outside the authoritative mutation path.

## Randomness

- RNG progression is persisted authoritative simulation-control state, not fictional truth and not an event.
- Each world has an explicit, versioned RNG algorithm, root seed, and next local-stream index. Seeds come from an explicit host dependency, never implicitly from wall-clock time.
- A stochastic resolution uses one deterministic local stream derived from the root seed and stream index. Multiple draws stay within that stream so changing one mechanic's draw count does not shift every later resolution.
- Stream use is lazy and transactional. Invalid, automatic, impossible, and uncertain-without-draw resolutions consume no stream; a tentative draw advances authoritative progression only when the complete resolution commit succeeds.
- Completed stochastic resolutions expose an inspectable reproduction trace. Checkpoints preserve the exact RNG progression captured with the rest of execution state.

## Monster challenge calibration

- A mechanically coherent creature is not automatically an appropriate or interesting player-facing challenge.
- Creature archetypes, concrete creature instances, and mechanical realization are distinct concepts.
- Meaningful monster design should establish a coherent core principle, behavior, at least one signature interaction, a tell, counterplay, and a plausible path to meaningful consequences.
- Monster challenge is evaluated against the expected party's actual capability profile, not Character Level alone.
- Baseline party capability is distinct from temporary current depletion/injury. Temporary weakness may affect pacing/selection but does not make an existing monster weaker.
- Challenge bands are Routine, Challenging, Hard, Severe, and Overwhelming. They are design/audit targets, not guaranteed outcomes, XP categories, or setting metaphysics.
- Simulation-originated monsters do not rubber-band to the player. Their threat follows origin, archetype, environment, survival/growth, and canonical world processes.
- New deliberately player-targeted monster content may use a party capability snapshot and intended challenge band when its threat envelope is first created.
- Once a creature/threat envelope is authoritative, later mechanical densification may not use the current party to silently rebalance it.
- Multi-creature challenge is scenario-level and non-linear; do not sum individual threat scalars as the source of truth.
- Pre-commit challenge audits should use actual registered rules operations in disposable deterministic/seeded test state where practical. The LLM may propose probes but cannot simply declare balance.
- Challenge calibration does not define XP. Progression remains based on the actual experienced growth/stakes rubric.

## Presentation

- The first version is text-first.
- Graphics are presentation only and never authoritative state.
- Portraits, backgrounds, maps, and generated scene art can be layered on later without changing the simulation model.

## Development

- Work should be organized into coherent Codex-sized capability slices, not tiny human-sized tickets.
- Each slice should have observable acceptance scenarios and clear boundaries.
- Prefer a working vertical slice over premature breadth.
