# LLM / AI Agent Guide

A single self-contained guide for AI coding agents (and humans) to work on this project. Read this before exploring the codebase.

> **Language note:** the repo's user-facing documentation (guides, ADRs, code comments) is in **Russian**. This guide and the agent files (`AGENTS.md`, `CLAUDE.md`) are in **English**. Domain terms (Handler, Input, Result, …) are English everywhere.

---

## 1. What this project is

**Brik** is a modular Discord bot on **TypeScript + bun + discord.js**. The core idea: **a contributor adds functionality without understanding the framework** — drop a module into `src/modules/`, it works.

- A **module** is a self-contained package of handlers declared via `defineModule`.
- A **handler** is one slash command (or a piece of atomic behavior) declared via `defineHandler`.
- The core auto-discovers modules; `bot.config.ts` only decides which are **enabled** and with which options.

## 2. Stack & commands

Runtime: **bun** (v1.3+, run script `bun`). Never use `npm`/`node` scripts here.

| Command | What it does |
|---|---|
| `bun install` | Install deps (uses `bun.lock`) |
| `bun run dev` | Dev: `bun --watch src/index.ts`, hot reload |
| `bun run start` | Production start |
| `bun test` | Run all co-located tests |
| `bun run test:coverage` | Tests + coverage report (threshold `0.7` in `bunfig.toml`) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun run check:boundaries` | Enforce module import boundaries (static check) |
| `bun run create:module <name>` | Scaffold a module + its test |
| `bun run deploy:commands` | Register slash commands via REST, no gateway |
| `bun run docs:dev` / `docs:build` / `docs:api` | VitePress site / TypeDoc |

**Verification loop after any change:** `bun test` → `bun run typecheck` → `bun run check:boundaries` → `bun run docs:build`.

## 3. Repository structure

```
src/
├── index.ts            # composition root: loadConfig → composeApp → start (error boundaries)
├── app/                # HOST layer: compose, lifecycle, interactor (no Discord types)
├── core/               # CORE: public contract + implementation
│   ├── index.ts        #   curated facade — the ONLY entry point for modules
│   ├── testing.ts      #   public test helpers (createInput, runHandler, createFakeInteraction)
│   ├── internal/       #   implementation: Registry, Pipeline, store, logger, config
│   ├── discord/        #   discord.js adapter: gateway, registrar, adapter (only place runtime discord.js lives)
│   └── *.test.ts       #   core tests co-located with code
└── modules/            # help, ping, roll, … each with a module.test.ts next to it
scripts/                # create-module, deploy-commands, check-boundaries
docs/                   # guides/, adr/, llm.md
bot.config.ts           # Enable decisions (which modules, with which options)
bunfig.toml             # bun test config (path ignore patterns, coverage threshold)
```

## 4. Domain glossary (ubiquitous language)

Use these terms consistently in code, comments, and docs. Avoid synonyms (`plugin`, `command`, `feature`, `framework`, `database`, `cache`).

| Term | Meaning | Avoid |
|---|---|---|
| **Bot** | One Discord app instance (one token, one gateway) that loads modules | service, application |
| **Module** | Self-contained package of Handlers via `defineModule`; may carry `setup`/`onReady`/`onShutdown`, state, and a public API for other modules | plugin, command, feature |
| **Handler** | Atomic behavior via `defineHandler`: name, arg schema, preconditions, capabilities, description. Maps an `Input` to a `Result`. Never calls other handlers directly — only public module functions | command, action |
| **Input** | Normalized slash invocation: name, parsed args, author, channel. No Discord API details | message, event, invocation |
| **Result** | Typed handler answer (text / embed / attachment) that the core delivers to the channel | response, reply, output |
| **Capability** | A right the Handler/module requires from the Bot in a channel (`EmbedLinks`, `AttachFiles`, …), checked before delivery | platform feature, permission |
| **Precondition** | A check before the handler runs (user perms, cooldown, NSFW channel…); built-in set + custom hook | guard, middleware |
| **Store** | Persistent KV provided by the core, namespaced per module; also per-channel dialog memory for multi-step flows | database, memory, cache |
| **Registry** | Registry of discovered modules/handlers (auto-discovery); source of truth for what can be enabled | index, collection |
| **Enable** | A `bot.config.ts` decision about which modules are active and with which options | register, activate, load |
| **Core** | Public framework contract modules import: `src/core/index.ts`. Stable, documented | framework, runtime, kernel |
| **Internal** | Implementation in `src/core/internal/`. Not stable, not accessible to modules | implementation, private API |
| **Host** | App assembly: `src/app/` + the discord adapter. Only place runtime discord.js lives | wiring, infrastructure |

## 5. Architecture & the import boundary

Three layers, each with a strict visibility rule:

| Layer | Where | Can modules import it? |
|---|---|---|
| **Core contract** | `src/core/index.ts` | ✅ **yes — the only entry point** |
| Test helpers | `src/core/testing.ts` | ✅ yes (in tests) |
| **Internal** implementation | `src/core/internal/` | ❌ no |
| Discord adapter | `src/core/discord/` | ❌ no |
| **Host** | `src/app/`, `src/index.ts` | ❌ no |

Rules a module must follow:

- Import **only** from `../../core/index.ts` in code, and `../../core/testing.ts` in tests.
- **Never** import `discord.js` directly — the runtime dependency lives only in `src/core/discord/` (and `Client` as a type-only escape hatch in host lifecycle).
- **Never** import `src/core/internal/*` or `src/app/*`.
- `scripts/check-boundaries.ts` enforces this statically; run `bun run check:boundaries` (part of CI).
- The core contract itself does **not** depend on discord.js at runtime: `ArgOptionType` is a string tag (`'string' | 'number' | 'integer' | 'boolean'`), mapped to Discord option types only in the registrar.

## 6. How to add a module

Fastest path — scaffold it:

```bash
bun run create:module economy
# → src/modules/economy/module.ts + module.test.ts
```

Typical shape (mirrors `src/modules/roll/module.ts`):

```ts
import { arg, defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: 'roll',
  description: 'Dice rolls',
  handlers: [
    defineHandler({
      name: 'roll',
      description: 'Roll dice: NdS',          // required — feeds /help
      args: {
        dice: arg.string('Formula, e.g. 2d6').default('2d6'),
      },
      preconditions: [{ type: 'guildOnly' }],   // optional
      capabilities: ['SendMessages'],           // optional
      run: ({ args }) => ({ kind: 'message', content: `🎲 ${args.dice}` }),
    }),
  ],
});
```

Key points:

- **Handlers are pure**: `run(ctx)` takes `{ input, store, memory, logger, args }` and returns a `Result`. No `ctx.client`, no network. The core delivers the Result to the channel.
- **Args** are declared with `arg.string/number/integer/boolean/enum(...)`; values are zod-parsed, defaults applied by the Pipeline.
- **Preconditions** (built-in): `guildOnly`, `dmOnly`, `nsfwOnly`, `ownerOnly`, `permissions`, `cooldown`, `custom`. Option validation on startup comes from `optionsSchema` (zod).
- **State**: persistent data via `ctx.store` (KV, namespaced by module name); short-lived per-channel state via `ctx.memory`. External DBs/APIs a module holds itself.
- **Public API for other modules**: export plain functions; other modules call those — they never call each other's handlers.
- **Lifecycle hooks**: `setup(ctx)`, `onReady(ctx)`, `onShutdown()`. `setup` receives a `commands: CommandCatalog` for `/help`-style listings.
- **Config options**: declare `optionsSchema` (zod); options are validated and injected on startup.

## 7. Testing conventions

- Tests are **co-located**: `src/modules/<name>/module.test.ts` sits next to `module.ts`. No separate `tests/` directory.
- Use public helpers from `../../core/testing.ts`:
  - `runHandler(handler, { args })` — runs the handler through the real Pipeline (parsing + defaults), fully in-memory. This is the primary way to test a handler.
  - `createInput(...)`, `createContext(...)`, `createFakeInteraction(...)` — build fakes for adapter/interactor tests.
- `bun test` must stay green; coverage threshold is `0.7` (`bunfig.toml`).
- `bunfig.toml` `pathIgnorePatterns` excludes `docs/**`, `scripts/**`, `research/**`, `.data/**` from test discovery.

## 8. Configuration (`bot.config.ts`)

```ts
import type { BotConfig } from './src/core/internal/config.ts';   // operator-facing internal type

export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
    // economy: { enabled: true, options: { startingBalance: 100 } },
  },
  owners: ['owner-user-id'],          // for the ownerOnly precondition
  devGuildId: 'dev-guild-id',          // fast command registration (or DISCORD_DEV_GUILD_ID)
} satisfies BotConfig;
```

- `BotConfig` lives in `src/core/internal/config.ts` — the **operator** writes it, so it uses the internal type, not the module contract.
- Token: `DISCORD_TOKEN` env (`envToken()` in `config.ts`), or `token` field.
- `devGuildId` (or `DISCORD_DEV_GUILD_ID`) → commands registered on a guild (instant updates); without it → globally (Discord caches, up to a minute).

## 9. ADR index

Architectural decisions live in `docs/adr/` (numbered). Read the relevant ones before changing that area.

- **0001** capability-as-channel-right — Capabilities are rights of the Bot in a channel, not platform features.
- **0002** framework-owned-state — state lives in a Store provided by the core (module does not own DB/cache).
- **0003** module-isolation-by-public-api — modules communicate only through public APIs, never through the framework internals.
- **0004** in-repo-modules-with-package-contract — modules live in the repo and are versioned with the core.
- **0005** slash-commands-with-sync-split — slash commands, with registration split between dev-guild and global sync.
- **0006** documentation-as-first-class — docs are a mandatory deliverable (guides, ADRs, glossary, TypeDoc).
- **0007** core-internal-host-layering — the layering this guide describes; curated facade, boundary script, co-located tests, bun conventions.

## 10. AI agent do / don't

**Do:**

- Start by reading this guide, `CONTEXT.md` (Russian glossary — the canonical term list), and `docs/guides/module-api.md`.
- Use **bun** for everything (never `npm`/`node`).
- Keep module imports inside the contract (section 5).
- Keep tests co-located and green; add a test for every new handler.
- Add a `description` to every handler — it feeds `/help` and slash autocomplete.
- Write user-facing docs/errors/comments in the language of the surrounding file (repo defaults to Russian; this guide/agent files are English).
- Run the full verification loop before declaring work done: `bun test`, `bun run typecheck`, `bun run check:boundaries`, `bun run docs:build`.

**Don't:**

- Don't import `discord.js` in `src/modules/**` (boundary check fails).
- Don't import `src/core/internal/**` or `src/app/**` from modules.
- Don't reach into `src/core/internal/` to bypass the contract — it is unstable by design.
- Don't call another module's handler directly — use its exported public functions.
- Don't move files between layers or change the facade without updating `docs/` and the ADRs.
- Don't add dependencies to modules unless truly necessary — the core contract is the dependency you get.
