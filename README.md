# Brik

Модульный Discord-бот на TypeScript + discord.js. Главная идея — **контрибьютор добавляет функционал, не понимая ядра**: положил модуль в `src/modules/` — он работает.

- **Модуль** = самодостаточный пакет команд (`defineModule`)
- **Команда** = атомарный Handler (`defineHandler`) со схемой аргументов, предусловиями и правами
- **Авто-дискавери**: ядро само находит модули, конфиг (`bot.config.ts`) только включает/выключает
- **Документация** — обязательная часть проекта: [гайды](docs/guides/getting-started.md) + [справочник API](docs/guides/module-api.md)

## Быстрый старт

```bash
bun install
cp .env.example .env        # впишите DISCORD_TOKEN (и DISCORD_DEV_GUILD_ID для dev)
bun run dev                 # dev-режим: hot reload, команды на dev-гильде
```

Тесты, проверка типов, границ и покрытия:

```bash
bun test                    # юнит-тесты (co-located рядом с кодом)
bun run test:coverage       # + отчёт о покрытии (global-порог: 70%, bunfig.toml)
bun run typecheck           # tsc --noEmit
bun run check:boundaries    # модули импортируют только публичный контракт core
```

Регистрация slash-команд без подключения к gateway:

```bash
bun run deploy:commands     # на dev-гильде (config.devGuildId) или глобально
```

## Структура

```
src/
├── index.ts            # composition root: loadConfig → composeApp → start
├── app/                # host: compose, lifecycle, interactor (без Discord-типов)
├── core/               # контракт + реализация
│   ├── index.ts        #   курируемый фасад — единственная точка входа для модулей
│   ├── testing.ts      #   публичные тест-хелперы (createInput, runHandler, ...)
│   ├── internal/       #   реализация: Registry, Pipeline, store, logger, config
│   ├── discord/        #   адаптер: единственное место runtime-discord.js
│   └── *.test.ts       #   тесты ядра рядом с кодом
└── modules/            # модули: help, ping, roll, ... (ваши) — каждый с тестом
├── scripts/            # create-module, deploy-commands, check-boundaries
├── docs/               # документация (гайды + ADR)
├── bot.config.ts       # включение/опции модулей
└── bunfig.toml         # конфигурация bun (test paths)
```

**Кому что видно:**

| Слой | Директория | Видят модули? |
|---|---|---|
| Контракт (Core) | `src/core/index.ts` | ✅ да — единственная точка входа |
| Тест-хелперы | `src/core/testing.ts` | ✅ да (в тестах) |
| Реализация (Internal) | `src/core/internal/` | ❌ нет |
| Адаптер Discord | `src/core/discord/` | ❌ нет |
| Host | `src/app/`, `src/index.ts` | ❌ нет |

## Добавить модуль

```bash
bun run create:module economy
# → src/modules/economy/module.ts + module.test.ts
```

Дальше — [гайд «Первый модуль»](docs/guides/your-first-module.md) и [CONTRIBUTING.md](CONTRIBUTING.md).

## Для чего это

- Бот с **одной осью расширения**: добавить функционал = добавить модуль.
- **CI** ([`.github/workflows/test.yml`](.github/workflows/test.yml)): `bun test` + `typecheck` + `check:boundaries` на каждый PR.
- **Глоссарий** (единый язык проекта) — в [`CONTEXT.md`](CONTEXT.md).
- **Архитектурные решения** (почему так) — в [`docs/adr/`](docs/adr/).
