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

## Development

The workspace keeps the native shell and game logic separated:

- `packages/engine` — DOM-free, game-agnostic TypeScript contracts, runtime orchestration, persistence ports, and an in-memory adapter
- `packages/reference-game` — headless ruleset, setting, adapter, campaign, and presentation modules for a tiny fixture
- `apps/desktop` — React/Vite presentation, the SQLite adapter, and a thin Tauri 2 host that registers migrations

Canonical changes follow `validate -> apply -> persist atomically -> expose`. Worlds are persistent campaign lineages. Current World State is separate from append-only meaningful event history and from future scheduled work. Named save slots point to immutable checkpoints of both state and the history visible at that point, so saving again moves the slot without rewriting history.

Install dependencies with `npm install`, then run the complete verification suite with:

```sh
npm run check
```

## Core principle

**Simulation owns truth. The LLM interprets, plans, and narrates around it without rewriting it.**
