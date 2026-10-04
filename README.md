# LLM RPG Engine

A local, single-player, text-first RPG engine where the player describes actions naturally, an LLM interprets those actions, and an authoritative simulation owns what is actually true. Awakening Earth is the first reference game built on the engine.

## North Star

The LLM is the player's interface to a persistent simulated world, not the source of truth for that world.

The engine/database owns canonical state, generic orchestration, time, validated mutations, and consequences. The active ruleset owns game-specific mechanics. The LLM interprets intent, retrieves relevant context, selects appropriate operations, reasons about NPC behavior, and narrates validated outcomes.

The engine does not know which game it is running. A `GameDefinition` composes one ruleset, setting, pair-specific setting adapter, campaign, and presentation configuration.

The LLM may also maintain a persistent, revisable GM plan across high, medium, and low horizons. That hidden plan guides attention and pacing; it never establishes truth, overrides simulation, or forces the player to preserve a plot.

## MVP

The first playable version should prove that a player can:

1. enter a small persistent world,
2. describe a freeform action,
3. have the game determine what that action means and whether it succeeds,
4. advance fictional time,
5. mutate authoritative world state,
6. interact naturally with NPCs,
7. leave and later return,
8. discover plausible changes produced by lazy world simulation while they were away.
9. adapt near-term campaign direction after a meaningful unexpected choice without treating the revised plan as a canonical event.

The MVP is text-first. Graphics are deliberately deferred until the engine works.

## Stack

- Tauri 2
- React + Vite
- TypeScript
- SQLite
- Ollama during development
- a llama.cpp-compatible bundled/local runtime path for shipping

## Planning

Project board: https://github.com/users/herringvoices/projects/10/

See:

- [Planning index](docs/planning-index.md)
- [Architecture invariants](docs/architecture-invariants.md)
- [MVP boundary](docs/mvp-boundary.md)
- [Board workflow](docs/board-workflow.md)
- [Glossary](docs/glossary.md)
- [Game package contracts](docs/game-package-contracts.md)
- [Context assembly and knowledge retrieval](docs/context-assembly.md)
- [Local model runtime](docs/model-runtime.md)
- [Player action execution pipeline](docs/player-action-pipeline.md)
- [Lazy world simulation and catch-up](docs/lazy-world-simulation.md)
- [Simulation and test harness](docs/simulation-test-harness.md)
- [First end-to-end playable loop](docs/first-end-to-end-playable-loop.md)
- [NPC state, knowledge, goals, and relationships](docs/npc-state-knowledge-goals-relationships.md)
- [NPC interaction and conversation](docs/npc-interaction-conversation.md)
- [Content and encounter principles](docs/content-encounter-principles.md)
- [Campaign planning and narrative direction](docs/campaign-planning-narrative-direction.md)
- [Character and creature mechanical generation](docs/character-creature-mechanical-generation.md)
- [Awakening Earth setting premise](docs/awakening-earth/setting-premise.md)
- [Awakening Earth institutions, economy, and society](docs/awakening-earth/institutions-economy-society.md)
- [Awakening Earth starting region generation](docs/awakening-earth/starting-region-generation.md)
- [Awakening Earth reference-game integration](docs/awakening-earth/reference-game-integration.md)
- [Awakening Earth monster design and challenge calibration](docs/awakening-earth/monster-design-challenge-calibration.md)

## Development

The workspace keeps the native shell and game logic separated:

- `packages/engine` — DOM-free, game-agnostic TypeScript contracts, runtime orchestration, persistence ports, and an in-memory adapter
- `packages/harness` — reusable deterministic scenario sessions, scripted models, diagnostics, semantic diffs, forks, probes, and reproduction replay
- `packages/reference-game` — the headless reusable Performance/Resistance ruleset plus the first setting, adapter, campaign, and presentation modules
- `apps/desktop` — React/Vite presentation, the SQLite adapter, and a thin Tauri 2 host that registers migrations
- `apps/harness-cli` — a persistent interactive developer shell over the same harness API used by Vitest

Canonical changes follow `validate -> apply -> persist atomically -> expose`. Worlds are persistent campaign lineages. Current World State is separate from append-only meaningful event history and from future scheduled work. Named save slots point to immutable checkpoints of both state and the history visible at that point, so saving again moves the slot without rewriting history.

Install dependencies with `npm install`, then run the complete verification suite with:

```sh
npm run check
```

Run the developer harness with `npm run harness`. The CLI ships with a tiny package-neutral fantasy fixture; additional plain-TypeScript scenarios can be registered by developer tooling. Set `HARNESS_MODEL_MODULE` to an ESM module exporting a provider-neutral `ModelRuntime` as `default` or `modelRuntime` to use a configured real local model interactively.

Run the playable desktop web shell with `npm run dev --workspace @llm-ttrpg/desktop`. It connects to Ollama at `VITE_OLLAMA_BASE_URL` (default `http://localhost:11434`) and uses `VITE_OLLAMA_MODEL` (default `qwen3:8b`). The Tauri host supplies the persistent SQLite database and the same UI/application boundary.

Build the Windows installer with `npm run bundle:windows` from a machine with Rust and the Visual Studio 2022 C++ Build Tools. The build script initializes the MSVC environment, downloads and verifies a pinned Windows CPU build of llama.cpp, then produces an NSIS `*-setup.exe` under `apps/desktop/src-tauri/target/release/bundle/nsis`. The installed app needs no Ollama, Rust, Visual Studio, or Python installation. On first launch it downloads the pinned Qwen3 8B Q4 model (about 5 GB), resumes interrupted downloads, verifies its SHA-256, starts an authenticated localhost model service, and stops that service when the app exits. The one-time model download is necessary because the model is larger than the NSIS single-file installer limit.

The shipping build currently targets 64-bit Windows and CPU inference for maximum compatibility. Allow roughly 7 GB of free disk space and 8 GB of RAM; more memory and faster CPUs improve play. See [third-party runtime notices](THIRD_PARTY_NOTICES.md) for pinned versions, licenses, and checksums.

The concrete selected mechanics are documented in [Reference Rules](docs/reference-rules.md). They remain ruleset-owned and are exposed through the engine's generic operation, resolution, and tool-catalog contracts.

## Core principle

**Simulation owns truth. The LLM interprets, plans, and narrates around it without rewriting it.**
