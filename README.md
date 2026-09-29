# LLM TTRPG

A local, single-player, text-first RPG where the player describes actions naturally, an LLM interprets those actions, and an authoritative simulation owns what is actually true.

## North Star

The LLM is the player's interface to a persistent simulated world, not the source of truth for that world.

The engine/database owns canonical state, calculations, constraints, time, mutations, and consequences. The LLM interprets intent, retrieves relevant context, selects appropriate operations/checks, reasons about NPC behavior, and narrates validated outcomes.

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

The MVP is text-first. Graphics are deliberately deferred until the engine works.

## Planned stack

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

## Core principle

**Simulation owns truth. The LLM interprets and narrates it.**
