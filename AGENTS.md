# AGENTS.md

Agent instructions for this repository (read by opencode, Cursor, Codex, and other coding agents).

## Canonical guide

Read **[`docs/llm.md`](docs/llm.md)** first — it is the single self-contained guide for AI agents working on this project (architecture, glossary, boundaries, workflows). The sections below are the critical facts in short form; `docs/llm.md` has the detail.

## Project in one paragraph

A modular **Discord bot** on **TypeScript + bun + discord.js**, codename **Brik**. Contributors add functionality by dropping a **module** into `src/modules/<name>/module.ts` (declared with `defineHandler`/`defineModule` from the core facade). The core auto-discovers modules; `bot.config.ts` decides which are enabled. Repo docs are in **Russian**; this file and `docs/llm.md` are in **English** (domain terms are English everywhere).

## Commands (bun, never npm/node)

```bash
bun install
bun run dev                 # hot reload
bun test                    # co-located tests
bun run test:coverage       # + coverage (threshold 0.7)
bun run typecheck           # tsc --noEmit
bun run check:boundaries    # module import boundaries
bun run create:module <name> # scaffold module + test
bun run deploy:commands     # register slash commands (REST)
```

## Hard rules

- Modules may import **only** `../../core/index.ts` (code) and `../../core/testing.ts` (tests). Never `discord.js`, `src/core/internal/**`, `src/core/discord/**`, or `src/app/**` from a module — `bun run check:boundaries` enforces this.
- Tests are **co-located** next to the code they test (no `tests/` dir); test handlers with `runHandler` from `../../core/testing.ts`.
- Every handler needs a `description` (feeds `/help`).
- Handlers are pure functions: `run(ctx)` returns a `Result`; the core delivers it. No `ctx.client`.
- After any change run: `bun test` → `bun run typecheck` → `bun run check:boundaries` → `bun run docs:build`.
