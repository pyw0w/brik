# CLAUDE.md

Instructions for Claude Code (and other AI coding agents) working in this repository.

## Canonical guide

Read **[`docs/llm.md`](docs/llm.md)** first — the single self-contained guide for AI agents: architecture, domain glossary, import boundaries, and how to add modules. This file is the short version; `docs/llm.md` has the detail.

## Project in one paragraph

A modular **Discord bot** on **TypeScript + bun + discord.js**, codename **Brik**. New functionality = a new **module** in `src/modules/<name>/module.ts` declared with `defineHandler`/`defineModule` from the core facade (`src/core/index.ts`). Modules are auto-discovered; `bot.config.ts` enables them. Repo docs are in **Russian**; this file and `docs/llm.md` are in **English** (domain terms like Handler, Input, Result are English everywhere).

## Commands (always bun, not npm/node)

```bash
bun run dev                  # hot reload (bun --watch src/index.ts)
bun test                     # co-located tests
bun run test:coverage        # + coverage (threshold 0.7)
bun run typecheck            # tsc --noEmit
bun run check:boundaries     # module import boundaries
bun run create:module <name> # scaffold a module + its test
bun run deploy:commands      # register slash commands via REST
```

## Hard rules

- Modules import **only** `../../core/index.ts` (code) and `../../core/testing.ts` (tests). Never `discord.js`, `src/core/internal/**`, `src/core/discord/**`, or `src/app/**` from a module — enforced by `bun run check:boundaries`.
- Tests are **co-located** (`src/modules/<name>/module.test.ts` beside `module.ts`); test handlers with `runHandler` from `../../core/testing.ts`.
- Every handler needs a `description` (feeds `/help`).
- Handlers are pure: `run(ctx)` returns a `Result`; the core delivers it. No `ctx.client`, no network in handlers.
- When a change touches layering or the facade, update `docs/` and the ADRs in `docs/adr/`.
- Before declaring a task done: `bun test` → `bun run typecheck` → `bun run check:boundaries` → `bun run docs:build`.
