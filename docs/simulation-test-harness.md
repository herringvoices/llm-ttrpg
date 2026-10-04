# Simulation & Test Harness

**Status:** Settled and implemented by Issue #16 — Simulation & Test Harness

**Scope:** A reusable developer harness for deterministic scenario setup, direct simulation control, model scripting, context/tool inspection, semantic state/history diffs, disposable forks, challenge probes, and reproducible bug reports without using the player UI.

## Goal

Developers must be able to answer:

> **What happened, why did it happen, what did the model see, what deterministic machinery ran, and can I reproduce it exactly?**

A simulation-heavy LLM RPG is not debuggable if every problem must be recreated by manually playing through the desktop UI.

The harness should make engine/game behavior directly inspectable while preserving the same authority, validation, persistence, RNG, context, tool, operation, and model-runtime boundaries used by normal play.

## Architecture

Use three layers:

1. **Scenario definition** — plain TypeScript data/setup describing a reproducible test/debug starting point.
2. **Headless harness session** — reusable programmatic API for manipulating and inspecting disposable worlds.
3. **Interactive CLI** — thin developer-facing shell using the headless API.

Vitest tests and the CLI must consume the same scenario definitions and harness API.

### Package boundary

Prefer a dedicated workspace package such as:

- `packages/harness` — generic developer/test harness built on public engine contracts;
- `apps/harness-cli` — Node interactive shell consuming the harness.

Exact paths may vary if repository conventions make another layout cleaner.

Do **not** place developer-only mutation/debug commands inside ordinary game operations or the player-facing tool catalog.

The generic engine may expose reusable diagnostic data required by the harness, but the harness remains a client of engine APIs rather than a privileged game subsystem.

## CLI vs Developer Panel

Implement the **headless API + interactive CLI** in #16.

Do not build an internal graphical developer panel yet.

A future panel may consume the same harness package without changing scenario semantics.

The CLI should support a persistent loaded session so developers can iteratively inspect and manipulate one scenario rather than invoking a new process for every command.

Conceptual usage:

```text
npm run harness

> scenarios
> load awakening.fixture-town
> state
> time +3w
> event inject test.route-disrupted scope.test-town
> catchup scope.test-town
> diff
> context actor campaign.entity.nina
> tools actor campaign.entity.nina
> action campaign.entity.player "I ask Nina what happened."
> trace decision
> fork before-fight
> use-fork before-fight
> ...
```

Exact command spelling is implementation detail, but equivalent capabilities are required.

A noninteractive command form may also exist for scripts/CI, but it must use the same API.

## Scenario Definitions

Use **plain TypeScript**, not YAML, JSON-only fixtures, or a custom scenario DSL.

A scenario definition should be schema/type checked and able to compose:

- stable scenario ID and description;
- selected `GameDefinition`;
- deterministic world seed;
- initial campaign/world construction or setup callback;
- optional checkpoint/source state;
- optional fictional time override;
- scripted model behavior;
- optional expected invariants/assertions;
- package-specific helper data.

Conceptual example:

```ts
defineScenario({
  id: "awakening.fixture-town",
  game: referenceGameDefinition,
  seed: 12345,
  setup: async (harness) => {
    // Validated setup through harness APIs.
  },
  model: scriptedModel([...]),
});
```

Do not invent a second language for scenario setup.

## Harness Session

A loaded scenario creates an isolated **HarnessSession** over disposable persistence.

The session must expose programmatic operations for at least:

- reset scenario;
- inspect current world metadata/state;
- inspect meaningful event history;
- inspect scheduled triggers;
- inspect simulation cursors/scopes/processes;
- inspect RNG state/progression;
- advance fictional time without automatically waking every simulation scope;
- catch up one chosen scope through the existing lazy-simulation path;
- inject validated test events/state;
- execute rules operations;
- execute player/freeform action orchestration with scripted or real model runtime;
- inspect context assembly and tool discovery;
- snapshot current harness-observable state;
- compute semantic diff against another snapshot;
- create disposable forks/clones;
- export a reproduction bundle.

All normal game actions still use production validation/transaction paths.

## Fictional Time vs Simulation Wake

Keep these operations explicitly separate.

### Advance time

Moving fictional time means only that the world's clock advances through an authorized harness operation.

It must **not** implicitly run every sleeping simulation scope.

### Catch up scope

A separate command explicitly invokes existing lazy-world catch-up for one requested simulation scope/wake closure.

This lets developers test the essential distinction:

> time has passed

versus

> this sleeping subsystem has now been brought current.

The harness should make simulation cursors before/after visible in the trace/diff.

## Determinism and RNG

Every scenario must be reproducible from a known seed and checkpoint/setup state.

Harness inspection should expose:

- world root seed;
- current/local stream index;
- per-resolution randomness traces where available;
- draw counts;
- fork seed behavior.

### Fork behavior

A disposable fork should begin from an exact harness snapshot/checkpoint.

By default it preserves the same RNG state so alternate approaches can be compared from identical conditions.

The caller may explicitly reseed or choose another RNG branch when desired.

Forks must never mutate a real/player campaign.

## Model Runtime Modes

Support two harness model modes.

### Scripted deterministic model

CI/scenario tests use a reusable scripted `ModelRuntime` implementation.

Script entries should match requests through stable diagnostic metadata and/or explicit predicates, then return:

- valid structured output;
- valid text output;
- configured model failure.

The scripted runtime must support deterministic failure cases such as:

- invalid structured output;
- schema-invalid data;
- timeout;
- cancellation;
- runtime unavailable;
- context-too-large/capability failures;
- deliberately contradictory/retconning proposals.

Avoid matching solely by brittle full prompt strings.

Every scripted invocation should be recorded in the harness trace with request identity, matched script step, and result.

### Real local model

The interactive harness may use the configured local model runtime for exploratory manual runs.

CI and deterministic acceptance tests must never depend on a real local model producing identical prose/structured choices.

The real-model mode should still capture the same request/result diagnostics.

## Validated Event / State Injection

Provide explicit test-only injection helpers for setup and reproductions.

### Safe injection

Normal harness injection must validate through canonical schemas/contracts and clearly mark harness/test provenance.

Examples:

- insert a valid canonical event at a specified fictional time;
- add a valid fact/belief/entity required by a scenario;
- schedule a valid trigger;
- establish a validated actor social state.

The harness must not bypass invariants merely because it is developer tooling.

### Unsafe corruption helper

Provide a clearly named, isolated escape hatch such as `unsafePatchWorldForTest` only for tests that intentionally exercise corruption/validation recovery.

Requirements:

- unavailable from player/runtime tool catalogs;
- visually/API-distinct from safe injection;
- emits diagnostic trace provenance;
- never used by normal scenario setup when a validated path exists.

## Snapshots

A **harness snapshot** is developer diagnostic data representing the inspectable state of a test world at one moment.

It should include references or normalized views of:

- game composition;
- world revision;
- fictional time;
- entities/facts/beliefs/documents;
- actor social state;
- mechanical realization state;
- scheduled triggers;
- simulation cursors;
- RNG state;
- meaningful event-history head/selected history;
- relevant interaction/action-run diagnostic state when available.

Snapshots are not player save slots and need not become a new production persistence concept.

Raw JSON export should be available for debugging, but it is not the primary comparison UX.

## Semantic Diff

Primary diff output should be a stable, semantic change set rather than an unreadable whole-world JSON diff.

At minimum, report changes by category:

- fictional time;
- world revision;
- entities added/removed/changed;
- facts added/removed/changed;
- beliefs added/removed/changed;
- actor goals/relationships/memories/commitments changed;
- mechanics/mechanical realization changed;
- scheduled work changed;
- simulation cursors changed;
- meaningful events appended;
- RNG state/stream progression;
- action/interaction diagnostic changes when requested.

Each change should retain enough source identity/path information to inspect the raw before/after values.

Ordering must be deterministic so snapshots/diffs are stable in tests.

Do not treat omitted unchanged data as changed.

## Traces

Use layered trace verbosity rather than one giant debug dump.

### Summary

Answers:

- what command/action ran;
- what authoritative result occurred;
- how much fictional time advanced;
- what major state/event categories changed;
- stop/failure result.

### Decision

Adds:

- selected simulation processes;
- operation/check path;
- model invocation role/perspective;
- context/tool selection;
- model structured decision;
- validation outcomes;
- committed mutation/event summaries;
- RNG trace;
- relevant no-retcon/authorization decisions.

### Full diagnostic

Adds the deepest available validated diagnostic material:

- rendered model request;
- authorized context package;
- context inclusion/omission diagnostics;
- context-local -> canonical debug bindings;
- tool tree/list/detail selections;
- model raw/parsed response where safe;
- operation prepared/basis/result records;
- proposed vs committed mutations/events;
- transaction/receipt data;
- exact semantic diff/raw values;
- simulation process inputs/diagnostics;
- scripted-model matching metadata.

Full trace is developer-only and may expose hidden canonical truth.

It must never be reused as actor/player context.

## Context and Tool Inspection

The harness must make model-facing information inspectable because many failures will be context/authorization failures rather than incorrect World State.

Provide commands/API to inspect, for a specified role/perspective:

- assembled context package;
- scene manifest;
- retrieved facts/beliefs/events/documents;
- omitted/context-budget diagnostics;
- context-local references;
- private debug mapping from local references to canonical IDs;
- available tool domains/subsystems/tools;
- detailed tool contracts;
- availability-policy decisions when available.

This diagnostic access must not weaken the normal actor-facing authorization layer.

## Operation and Action Execution

Support both levels.

### Direct operation execution

Developers may execute a specific registered rules operation with explicit validated arguments to isolate mechanics.

### Normal freeform action execution

Developers may submit a freeform declaration through the same player-action/conversation orchestration used by normal play, using scripted or real model runtime.

The harness trace should expose:

- interpreted intent;
- pressure/horizon;
- discovered/selected tools;
- resolution basis/path;
- RNG;
- proposals/commits;
- elapsed fictional time;
- final stop reason;
- narration/model result where applicable.

Do not build a harness-only imitation of the action pipeline.

## Disposable Forks and Challenge Probes

Support exact disposable branches from a scenario/snapshot.

Example:

- Fork A: awakened punch;
- Fork B: held bat;
- Fork C: mundane firearm;
- Fork D: flee.

Forks allow repeated alternatives from identical initial conditions.

### Monster challenge probes

#35 challenge audits may define a set of representative approaches and seeds over one disposable base state.

The harness:

- executes real rules;
- records outcomes/traces;
- summarizes comparisons.

The harness does **not** decide whether a creature is balanced.

Challenge-band judgment remains game/design logic outside the generic harness.

## Reproduction Bundles

A harness run should be exportable into a compact machine-readable **reproduction bundle** sufficient to recreate a bug when possible.

Include:

- bundle/schema version;
- scenario ID;
- game component identities/versions;
- starting snapshot/checkpoint reference or serialized disposable fixture;
- world seed and RNG state;
- fictional time;
- harness command/action sequence;
- scripted model steps/results when using scripted mode;
- relevant user declarations;
- package/process/operation IDs involved;
- resulting trace level requested;
- expected/observed assertion or failure information.

Do not include unrelated full-world secrets when a minimal bundle can reproduce the issue.

Provide an import/replay path.

A reproduced failure should be easy to turn into a permanent regression scenario/test.

## Interactive CLI

Implement a small REPL-style shell.

Required capability groups:

### Scenario/session
- list scenarios;
- load/reset scenario;
- show selected game composition;
- show session status;
- exit.

### Inspect
- world/state;
- entity/fact/belief/social state;
- event history;
- time/RNG;
- simulation scopes/processes/cursors;
- registered operations;
- context;
- tools;
- current trace.

### Manipulate
- advance fictional time;
- safe event/state injection;
- schedule trigger where schema allows;
- catch up scope;
- execute direct operation;
- submit freeform action.

### Compare/reproduce
- snapshot;
- diff;
- fork/list/use/discard fork;
- export/import/replay reproduction bundle;
- select trace level.

CLI output should default to human-readable summaries and offer JSON for machine/debug use.

The CLI is developer tooling and does not need polished player UX.

## Package Selection

A scenario selects a complete `GameDefinition`.

The harness must discover operations, event types, simulation processes/scopes, tools, context behavior, and package-specific fixture content from that game composition.

Do not hard-code Awakening Earth concepts in the harness.

## Alternate-Game Architecture Fixture

Include a deliberately tiny **test-only fantasy GameDefinition** as an architecture acceptance fixture.

It should be just large enough to prove harness and engine package generality, for example:

- one town;
- one wizard/player;
- goblin creatures;
- a few fantasy facts/mechanics;
- one simple operation/check;
- one small simulation process or scenario.

Requirements:

- defined under test/support or equivalent, not promoted to a second product/game;
- runs through the same harness without modifying `packages/engine`;
- no Awakening Earth IDs/assumptions required;
- no broad worldbuilding/polish.

This is an architecture test, not MVP content.

## Vitest Integration

Provide helpers so a TypeScript scenario can become a normal Vitest scenario test without duplicating setup.

A test should be able to:

1. load/reset scenario;
2. run harness commands programmatically;
3. inspect semantic diff/trace;
4. assert world/event/context outcomes;
5. dispose automatically.

Avoid giant brittle serialized snapshots as the default assertion style.

Prefer semantic assertions plus stable selected snapshots/diffs where useful.

## Existing Fixture Migration

Reuse/compose current `tests/support` fixtures rather than discarding them.

Existing assets such as:

- contract game operations;
- simulation test game;
- SQLite in-memory persistence;
- deterministic RNG tests;
- context/tool tests;

should become inputs/examples for the harness where practical.

#16 should reduce duplicated setup over time rather than force a rewrite of every test immediately.

## Implementation Contract

Provide validated/public harness APIs approximately equivalent to:

- `defineScenario(...)`
- `createHarness(...)`
- `loadScenario(...)`
- `reset()`
- `inspect...`
- `advanceTime(...)`
- `catchUp(...)`
- `inject...`
- `executeOperation(...)`
- `executeAction(...)`
- `snapshot()`
- `diff(...)`
- `fork(...)`
- `exportReproduction(...)`
- `replayReproduction(...)`

Exact names are implementation detail.

Use public engine/package contracts where possible. If deeper diagnostics are genuinely needed, add explicit read-only diagnostic surfaces rather than reaching into private persistence internals from the CLI.

## Verification Scenarios

### Three-week town catch-up

1. load deterministic fixture town;
2. record initial snapshot;
3. advance fictional time three weeks without waking the town;
4. verify town cursor/state have not yet caught up;
5. inject a valid external route disruption during the elapsed interval;
6. catch up the town;
7. capture summary/decision/full traces;
8. produce semantic diff;
9. verify only wake-closure scopes/processes ran;
10. reset and repeat from the same seed;
11. verify identical authoritative result/RNG trace.

### Model/context debugging

1. load a scenario with two NPCs holding different beliefs;
2. inspect actor-context package for each;
3. verify hidden/unowned information is absent;
4. execute a scripted-model conversation/action;
5. inspect selected tools, structured decision, checks, mutations, and time;
6. force one invalid structured model response;
7. verify failure is traceable and commits no invalid partial state.

### Disposable monster probes

1. load one exact player/monster state;
2. fork into multiple branches;
3. run representative approaches under selected identical seeds;
4. compare semantic diffs/outcomes;
5. verify base state remains unchanged;
6. export one branch as reproduction bundle and replay it exactly.

### Alternate package

Run the tiny fantasy architecture fixture through:

- scenario load;
- direct operation;
- time/catch-up if applicable;
- context/tool inspection;
- snapshot/diff.

Verify no engine/harness branch recognizes Awakening Earth specifically.

## Implemented Seam

Issue #16 is implemented as two developer-only workspace packages:

- `packages/harness` provides plain-TypeScript scenarios, isolated deterministic `HarnessSession` instances, validated mutation/event injection, explicit unsafe corruption testing, separate time and catch-up control, production operation/player-action/conversation execution, context/query/tool inspection, semantic snapshots/diffs, layered traces, exact disposable forks, seeded challenge probes, and reproduction export/replay;
- `ScriptedModelRuntime` matches stable invocation metadata and predicates, supports dynamic or static structured/text results plus all provider-neutral failure kinds, validates outputs through the requested Zod schema, and records matched-step diagnostics;
- reproduction bundles serialize the exact starting disposable state/history, deterministic command sequence, scripted invocation diagnostics, and expected final state/history so forks replay from their real checkpoint rather than merely resetting a scenario;
- `apps/harness-cli` is a persistent REPL over the same public harness API, with human-readable or JSON output for scenario/session, inspection, mutation, comparison, fork, trace, export, and replay commands;
- `HARNESS_MODEL_MODULE` lets the CLI load an externally configured provider-neutral real `ModelRuntime` without making CI depend on real-model determinism;
- `fantasy.fixture-town` is a tiny test/developer-only wizard/goblin package with its own operation and lazy simulation process, proving the harness contains no Awakening Earth branch.

The harness remains a client of public engine contracts. Its injection and corruption helpers are methods on the developer package and never enter a game operation registry or player tool catalog.

## Verification

`tests/harness.test.ts` composes the existing lazy-simulation and contract-game fixtures and verifies:

- a deterministic three-week town run where time advancement does not wake simulation, validated route disruption carries harness provenance, selected-scope catch-up produces stable process/RNG diagnostics, and reset reproduces identical state/history;
- separately authorized actor knowledge queries, tool contracts, normal #11 freeform action execution, scripted schema failure, and no partial authoritative commit;
- exact fork isolation, seeded probes, export, and replay from a changed branch checkpoint;
- normal #14 conversation orchestration and scripted invocation capture;
- package-neutral fantasy operation/context/tool/time/catch-up behavior plus isolated unsafe corruption and reset recovery.

The completed repository gate passes:

```text
npm run check
Test Files  19 passed | 1 skipped (20)
Tests       151 passed | 1 skipped (152)
```

## Acceptance Criteria

- [x] reusable headless harness package exists independently of the normal player UI
- [x] interactive developer CLI consumes the same harness API
- [x] CLI maintains a loaded scenario/session for iterative debugging
- [x] scenarios are plain TypeScript definitions, not a custom DSL
- [x] Vitest and CLI can use the same scenario definitions
- [x] deterministic scenario reset reproduces the same starting state
- [x] fictional-time advancement is separate from lazy-scope catch-up
- [x] a chosen simulation scope can be caught up directly
- [x] seed/RNG state and randomness traces are inspectable
- [x] validated test event/state injection exists with clear harness provenance
- [x] unsafe corruption helper is isolated/obviously unsafe and absent from player tooling
- [x] scripted model runtime supports deterministic structured/text success and failure cases
- [x] interactive harness may use the real local model without making CI depend on it
- [x] direct registered operations can be executed through production validation paths
- [x] freeform actions can execute through normal orchestration with mocked or real model responses
- [x] context packages and perspective/omission diagnostics can be inspected
- [x] tool discovery/contracts/availability can be inspected
- [x] semantic snapshots/diffs cover time, state, social data, mechanics, scheduled work, cursors, events, and RNG
- [x] semantic diff ordering is deterministic and raw before/after values remain inspectable
- [x] summary, decision, and full diagnostic trace levels exist
- [x] full diagnostics remain developer-only and do not weaken actor authorization
- [x] disposable forks preserve exact base state and cannot mutate the source world
- [x] seeded monster-challenge probes can run repeatedly over disposable forks
- [x] reproduction bundles can export and replay a failing scenario/run
- [x] a replayed deterministic bundle reproduces the same authoritative result/trace-relevant identifiers
- [x] existing test-support fixtures are reusable through the harness where practical
- [x] tiny fantasy architecture fixture runs through the harness without engine changes
- [x] tests/scenarios run without opening the desktop player UI
- [x] `npm run check` passes

## Non-Goals

- player-facing cheats/admin console
- polished graphical developer panel
- production telemetry/analytics service
- automatic whole-game balance optimizer
- custom YAML/JSON scenario language
- replacing Vitest
- making real local-model output deterministic
- exposing unsafe harness mutation tools to production gameplay
- building a second full fantasy game
