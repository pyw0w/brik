# Контрибьюция

Спасибо, что хотите добавить функционал. Главное правило: **вам не нужно понимать ядро** — только публичный API модулей.

## Обязательный минимум для PR

1. **Модуль в `src/modules/<name>/module.ts`** — объявлен через `defineModule`.
2. **`description` у каждого Handler-а** — это питает `/help` и автоподстановку slash-команд.
3. **Юнит-тест на `run()`** — `bun test` должен быть зелёным.
4. **`bun run typecheck`** — без ошибок.
5. **`bun run check:boundaries`** — модуль не импортирует ничего из ядра, кроме публичного контракта.

Проверка перед отправкой:

```bash
bun test
bun run test:coverage       # global-порог 70% — в bunfig.toml
bun run typecheck
bun run check:boundaries
```

То же самое прогоняет CI ([`.github/workflows/test.yml`](.github/workflows/test.yml)) на каждый PR.

## Как добавить модуль

Быстрый путь — генератор:

```bash
bun run create:module economy
```

Он создаёт каркас (`module.ts` + `module.test.ts` рядом с кодом) и с ним вы уже соответствуете обязательному минимуму. Пошагово — в [гайде «Первый модуль»](docs/guides/your-first-module.md).

## Ревью

- Ревьюит владелец проекта.
- Модули живут в репозитории и версионируются вместе с ядром (решение — [ADR-0004](docs/adr/0004-in-repo-modules-with-package-contract.md)).
- Объём: одна команда — нормально, целая фича из нескольких команд — тоже нормально.

## Полезно знать

- **Глоссарий**: термины проекта — в [`CONTEXT.md`](CONTEXT.md). Используйте их в коде и комментариях (Handler, Input, Result, Capability, Precondition, Store, Enable...).
- **Справочник API**: [`docs/guides/module-api.md`](docs/guides/module-api.md).
- **Dev-режим**: [`docs/guides/dev-mode.md`](docs/guides/dev-mode.md).
