# Research: публичный API фреймворка vs внутренняя реализация (public surface vs internals)

**Дата:** 2026-08-03
**Вопрос:** как в TypeScript разделять «публичный API фреймворка» (то, что импортируют контрибьюторы-модули) и «внутреннюю реализацию» (internals), и что из этого применить в `ds`.

---

## 1. Текущие проблемы

Перед исследованием прочитаны: `src/core/index.ts`, `src/core/*.ts`, `src/core/discord/*.ts`, `src/modules/*/module.ts`, `tests/*`, `docs/adr/*`, `docs/guides/module-api.md`, `package.json`, `tsconfig.json`.

### 1.1. `src/core/index.ts` — один батч без деления на public/internal

```ts
// src/core/index.ts (сейчас — 16 строк, всё вперемешку)
export { arg, toDiscordOptions } from './args.ts';
export { Bot } from './bot.ts';                                   // ← host/внутренности
export { loadConfig, envToken } from './config.ts';               // ← host/внутренности
export { createLogger } from './logger.ts';                       // ← внутренности
export { defineHandler } from './handler.ts';
export { defineModule } from './module.ts';
export { Pipeline, PipelineGateError, capabilityLabel } from './pipeline.ts'; // ← внутренности
export { Registry } from './registry.ts';                         // ← внутренности
export { FileStore, InMemoryChannelMemory, MemoryStore } from './store.ts';  // ← внутренности
export * from './types.ts';                                       // ← wildcard
```

- Публичный контракт модуля (`defineModule`, `defineHandler`, `arg`) смешан с реализацией (`Bot`, `Registry`, `Pipeline`, `FileStore`, `createLogger`, `loadConfig`).
- Контрибьютор, у которого «всё светится», легко импортирует `Bot` или `Registry` и навсегда завязывается на внутренности — ровно то, против чего направлен ADR-0003 («контракт модуля… зависит только от публичного API ядра»).
- `export * from './types.ts'` — wildcard: любой будущий `export` из `types.ts` автоматически становится публичным API (accidental API), даже если планировался внутренним.
- Модули формально уже импортируют только из `../../core/index.js` (хорошо), но фасад не «курируется» — он шире, чем контракт.

### 1.2. Runtime-импорты discord.js внутри «ядра»

- `src/core/args.ts:2` — `ApplicationCommandOptionType` (runtime-значение) из discord.js.
- `src/core/bot.ts:1-11` — `Client`, `GatewayIntentBits`, `ChannelType`, `PermissionFlagsBits`, `EmbedBuilder` и т.д. (runtime).
- `src/core/discord/registrar.ts` — `SlashCommandBuilder`, `Client` (runtime).

Это нормально для *адаптера*, но нарушает требование «core не импортирует discord.js» как слой: `args.ts` и контракт `ArgSpec.discordType: number` несут в себе детали discord.js.

### 1.3. Публичный контракт течёт discord.js-типами

- `src/core/types.ts:1` — `Result` использует `EmbedData` из discord.js.
- `src/core/module.ts:1,13` — `ModuleReadyContext.client: Client` — сырой discord.js в жизненном цикле модуля.
- `src/modules/help/module.ts:1` — модуль сам импортирует `Client` из discord.js (обход контракта).

Требование «core не импортирует discord.js (кроме типов)» на уровне типов частично соблюдено (type-only), но сырой `Client` и `EmbedData` «просачиваются» в публичный API модулей — контракт становится зависимым от discord.js как от стабильного типа, а не как от адаптера.

### 1.4. Конвертация Input↔interaction и Result↔payload живёт в `bot.ts`

`toInput()`, `preconditionEnv()`, `grantedCapabilities()`, `resultToPayload()`, `toApiEmbed()` — всё в `src/core/bot.ts` (composition root), вперемешку с жизненным циклом. Это «адаптер» по сути, но физически он не отделён от «ядра» и не выделен в свою директорию.

### 1.5. Нет механического enforcement

- В проекте **нет eslint-конфига вообще** (в `package.json` только `tsc` + `bun test`). Соответственно нет ни `no-restricted-imports`, ни `import/no-internal-modules` — границу «модули импортируют только из `core/index`» никто не проверяет.
- `tsconfig.json` — `noEmit: true`, `stripInternal` не настроен; `typedoc` (`docs:api`) документирует **весь** `src/core` (`--entryPointStrategy expand --entryPoints src/core`), т.е. внутренности попадают в API-документацию наравне с контрактом (против ADR-0006).

---

## 2. Best practices (с источниками)

### 2.1. Barrel — это «public API facade», а не свалка

- Barrel (`index.ts`) должен экспортировать *публичный API группы*, а не всё подряд: «включить в barrel = публичные функции/классы/типы/ошибки; оставить внутри = приватные хелперы, внутренние типы, константы конфигурации». Если barrel реэкспортирует 30 имён из 15 файлов — группа слишком широкая, её нужно дробить. ([RuneHub, Barrel Files in TypeScript](https://rune.codes/hub/typescript/barrel-files-in-typescript))
- **Wildcard (`export *`) опасен**: случайный экспорт внутренностей в публичный API, коллизии имён, труднее трассировка, хуже IDE. «Named exports make your barrel's public API explicit and intentional». ([Marc Nuri, Barrel Exports](https://blog.marcnuri.com/barrel-exports-javascript-typescript))
- Разница «barrel (свалка) vs API facade (куратор)»: барrel выставляет `export *` и внутренние файлы видны; facade экспортирует только намеренную поверхность и скрывает внутренности. ( [PViz, TypeScript Module Boundaries: Barrel Files vs Clean Module Boundaries](https://pvizgenerator.com/blog/typescript-module-boundaries) )
- Принцип Feature-Sliced Design: «**If it's not in the public API, it's not supported**»; внутренние модули должны быть импортируемы только изнутри библиотеки; публичный API — это «gate». ([Feature-Sliced Design + Rollup library architecture](https://feature-sliced.design/blog/rollup-library-architecture))
- Производительность: barrel из многих модулей замедляет старт/дерево-шейкинг; держать барrel-файлы на границах, а не глубоко внутри. ([RuneHub](https://rune.codes/hub/typescript/barrel-files-in-typescript), [PViz](https://pvizgenerator.com/blog/typescript-module-boundaries))

**Реальный пример фасада** — `@sapphire/framework` (Discord-бот-фреймворк, прямой аналог): `src/index.ts` — один курируемый список именованных реэкспортов (`export { container, ... } from '@sapphire/pieces'; export * from './lib/structures/Command'; export * as Resolvers from './lib/resolvers/index'; ...`), без единого мега-bundle-из-всего. ([sapphiredev/framework/src/index.ts](https://github.com/sapphiredev/framework/blob/main/src/index.ts))

### 2.2. Facade-паттерн: контракт стабилен, реализация меняется

- Facade — слой абстракции между потребителем и реализацией; даёт контроль над выставленным API и возможность менять внутренности «под капотом» без влияния на потребителей. ([Kyle Shevlin, Facade Pattern](https://kyleshevlin.com/facade-pattern/), GoF «Design Patterns»)
- «Хороший фасад не должен протекать абстракциями — не выставляйте объекты подсистем и не требуйте от клиента знания деталей подсистем». ([Medium, The Facade Pattern in Modern JavaScript](https://medium.com/@artemkhrenov/the-facade-pattern-in-modern-javascript-simplifying-complex-systems-df4de098529b))

### 2.3. Hexagonal / ports & adapters: ядро не знает о фреймворке

- Ядро (domain/контракт) имеет **ноль зависимостей от внешних фреймворков**; порты — интерфейсы (что нужно/что доступно), адаптеры — реализации, единственное место, где живёт код фреймворка/инфраструктуры. Замена адаптера (Postgres → Mongo, HTTP → WebSocket) не трогает ядро. ([Generalist Programmer, Hexagonal Architecture + TS](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide), [ArchMan, Ports & Adapters](https://archman.dev/docs/architectural-styles/hexagonal-ports-and-adapters), [chanhle.dev](https://chanhle.dev/en/blog/hexagonal-architecture-ports-adapters))
- Питфол «Leaky Abstraction»: порт не должен выставлять инфраструктурные детали (типы discord.js = аналог «SQL-запросов в порту»). ([ArchMan](https://archman.dev/docs/architectural-styles/hexagonal-ports-and-adapters))
- Для бота это буквально: `Input ↔ interaction` и `Result ↔ payload` — работа *driving-адаптера* (discord), не ядра.

### 2.4. Как скрыть internals в TS (по возрастанию жёсткости)

TS не имеет «настоящей приватности модулей» — любой файл в репозитории можно импортировать напрямую. Поэтому используют **связку конвенций + тулинга**:

1. **`internal/`-директория** — папка-маркер: код внутри — внутренний. Используется повсеместно:
   - `lit` — `export * from './internal/...'` ([lit-localize.ts](https://github.com/lit/lit/blob/main/packages/localize/src/lit-localize.ts));
   - `apify/crawlee` — `export * from './internals/...'` в `src/index.ts` ([crawlee/packages/utils/src/index.ts](https://github.com/apify/crawlee/blob/master/packages/utils/src/index.ts));
   - `svelteui` — `export * from './internal/index.js'` ([svelteuidev/svelteui](https://github.com/svelteuidev/svelteui/blob/main/packages/svelteui-core/src/index.ts));
   - Paddle SDK — публичный `src/index.ts` **явно** реэкспортирует из `./internal/index.js` ([paddle-node-sdk](https://github.com/PaddleHQ/paddle-node-sdk)).
2. **`@internal` + `stripInternal`** — JSDoc-тег `/** @internal */` + флаг `stripInternal: true` убирают символ из генерируемых `.d.ts` (не будет в автокомплите и в типах пакета). Используют: Angular (`packages/tsconfig-build.json`), MUI (каждый `tsconfig.build.json`), Next.js (turbopack js). ([SO: Typescript library: Hide internal exports](https://stackoverflow.com/questions/59122428), [TSDoc @internal](https://tsdoc.org/pages/tags/internal/))
3. **Механический запрет глубоких импортов** — eslint:
   - `no-restricted-imports` с паттернами границ (electron запрещает `electron/renderer` из main; sanity запрещает `styled-components`; qawolf запрещает `../*` из core). ([eslint no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports))
   - `import/no-internal-modules` из `eslint-plugin-import` — «forbid importing the submodules of other modules» ([rule docs](https://github.com/import-js/eslint-plugin-import/blob/master/docs/rules/no-internal-modules.md)). В списке non-обязательных для oxc: «покрывается `no-restricted-imports`» ([oxc unsupported-rules](https://github.com/oxc-project/oxc/blob/main/tasks/lint_rules/src/unsupported-rules.json)).
   - MUI enforce «one-level import rule»: `no-restricted-imports` запрещает `@mui/*/*/*` (только `@mui/material` и `@mui/material/Button`, но не `Button/Button`), чтобы глубокие импорты не тянули приватные детали. ([ReadOSS, MUI package pyramid](https://readoss.com/en/mui/material-ui/material-ui-internals-architecture-package-dependency-pyramid))
4. **`package.json` `exports`** — «ваши папки — не ваш API»: `exports`-мапа пакета определяет разрешённые пути импорта и блокирует deep-import (`@acme/utils/dist/internal/secret`). ([Frontend Interview, package.json exports](https://www.frontendinterview.in/blog/typescript-package-exports-and-types))
5. **Отдельные internal-пакеты/пространства** — MUI держит `packages-internal/*` (`@mui/internal-*`, `@mui-internal/*`) — непубликуемые пакеты с внутренним кодом, отдельные от `packages/*`. ([mui/material-ui, AGENTS.md](https://github.com/mui/material-ui/blob/master/AGENTS.md), [packages-internal](https://github.com/mui/material-ui/tree/master/packages-internal))

### 2.5. Naming: Core / Framework / Host

- Реальные примеры используют «core» для публичного контракта и жизни приложения, а инфраструктуру — отдельными слоями:
  - `@sapphire/framework` — единый пакет, `SapphireClient` = host/entry point, публичные структуры (`Command`, `Precondition`, `Listener`) — «то, что наследуют пользователи». ([sapphiredev/framework](https://github.com/sapphiredev/framework))
  - `@spraxium` — делит на `@spraxium/core` (runtime/DI/жизненный цикл) и `@spraxium/common` (декораторы/контракты), плюс отдельные пакеты под инфраструктуру (`/logger`, `/components`, `/schedule`). Публичный контракт и runtime разнесены по пакетам. ([spraxium.com](https://spraxium.com/en))
  - discord.js сам построен как ядро `discord.js` + субпакеты (`@discordjs/builders`, `@discordjs/rest`, `@discordjs/voice`) — субpath-экспорты держат публичную поверхность маленькой. ([discord.js packages](https://github.com/discordjs/discord.js), [discord.js.org/docs](https://discord.js.org/docs))
- Для `ds` понятия: **Core** = публичный контракт, который импортируют модули (стабильный, документированный); **Internal** = реализация этого контракта (Registry, Pipeline, Store-реализации, Logger); **Host/Adapter** = wiring (Bot, discord-клиент, регистрация команд, конвертации Input/Result) — единственное место, где живёт runtime-discord.js.

### 2.6. Тест-утилиты

- MUI выносит тестовые хелперы в отдельный внутренний пакет `@mui/internal-test-utils`, непубликуемый. Тесты ядра могут импортировать внутренности напрямую (это нормально) — граница «стабильно для модулей» ≠ «невидимо для тестов ядра». ([mui/material-ui AGENTS.md](https://github.com/mui/material-ui/blob/master/AGENTS.md))

---

## 3. Рекомендации для этого проекта

### 3.1. Публичный фасад: что экспортировать из `src/core/index.ts`

Сделать `src/core/index.ts` **курируемым фасадом** — только контракт. Убрать `export * from './types.ts'` и перечислить всё явно.

**Видно контрибьютору (экспортировать):**

| Символ | Файл |
|---|---|
| `defineModule`, типы `Module`, `ModuleDef`, `ModuleOptions`, `ModuleSetupContext`, `ModuleReadyContext` | `module.ts` |
| `defineHandler`, типы `Handler`, `HandlerDef`, `HandlerRunContext` | `handler.ts` |
| `arg`, типы `ArgsSchema`, `ArgsOf`, `ArgSpec` | `args.ts` |
| типы `Input`, `Result`, `PreconditionSpec`, `PreconditionOutcome`, `PreconditionContext`, `Capability`, `CHANNEL_CAPABILITIES`, `ChannelRef`, `UserRef`, `Store`, `ChannelMemory`, `Logger` | `types.ts` |

**Скрыть от контрибьютора (НЕ экспортировать):** `Bot`, `BotOptions`, `Registry`, `Pipeline`, `PipelineGateError`, `capabilityLabel`, `FileStore`, `MemoryStore`, `InMemoryChannelMemory`, `createLogger`, `loadConfig`, `envToken`, `toDiscordOptions`, `parseArgs`, `toSlashCommand`, `syncCommands`, `PreconditionEnv`, `ModuleEntry`, `BotConfig`. (Остаются доступны внутри `src/core/**` и тестам ядра.)

### 3.2. Структура: `src/core/` (контракт) + `src/core/internal/` + `src/core/discord/` (адаптер)

Предложенная раскладка (минимальная миграция, без переименования `core`):

```
src/
  core/
    index.ts              # фасад: только публичный контракт (см. 3.1)
    types.ts              # только типы; НОЛЬ runtime-импортов discord.js
    handler.ts            # defineHandler + типы
    module.ts             # defineModule + типы
    args.ts               # arg + типы (без discord.js runtime)
    internal/
      registry.ts         # Registry (не публикуется)
      pipeline.ts         # Pipeline, capabilityLabel, PreconditionEnv
      store.ts            # FileStore, MemoryStore, InMemoryChannelMemory
      logger.ts           # createLogger
      config.ts           # loadConfig, envToken, BotConfig, ModuleEntry
      bot.ts              # Bot — host (composition root; импортируется только из src/index.ts и тестов)
    discord/
      adapter.ts          # toInput(), resultToPayload(), toApiEmbed(), preconditionEnv(), grantedCapabilities()
      registrar.ts        # toSlashCommand(), syncCommands()
```

Императив из hexagonal: **директория `src/core/` (без `internal/` и `discord/`) должна иметь ноль runtime-импортов discord.js**; все импорты discord.js — только в `src/core/discord/` (type-only — в контракте).

### 3.3. Адаптер discord — единственное место конвертаций

Перенести из `bot.ts` в `src/core/discord/adapter.ts`: `toInput()` (Input←interaction), `resultToPayload()` и `toApiEmbed()` (payload←Result), `preconditionEnv()`, `grantedCapabilities()`. Тогда `types.ts`/`args.ts`/`handler.ts`/`module.ts` перестают тащить discord.js, а `Bot` (host) только композирует: `adapter.toInput(...)`, `adapter.resultToPayload(...)`.

### 3.4. Убрать сырой `Client` из публичного контракта

`ModuleReadyContext.client: Client` — единственная «протечка» discord.js в жизненный цикл модуля (help-модуль уже импортирует `Client` сам). Варианты:
- (рекомендуется) оставить `client` только в `ModuleReadyContext` (это уже «продвинутый escape hatch», задокументированный в `module-api.md`), но вынести тип в `src/core/discord/` и пометить `/** @internal */`/заметкой «advanced», чтобы контракт `src/core/index.ts` не реэкспортировал `Client`;
- либо ввести узкий собственный интерфейс `BotClient` с минимальными методами (`fetchCommands()`, `send(...)`), а сырой `client` — отдельным необязательным полем.
`EmbedData` в `Result` оставить type-only импортом (требование «кроме типов» соблюдено) — и задокументировать в `module-api.md`, что это намеренно.

### 3.5. Механический enforcement

Проект без линтера — добавить минимальный eslint (или oxlint) с двумя правилами:
1. `no-restricted-imports` (или `import/no-internal-modules`): в `src/modules/**` разрешён только импорт `../../core/index.js`; запретить любые `../core/bot`, `../core/internal/*`, `../core/discord/*`, а также прямые импорты `discord.js` из модулей.
2. Внутри `src/core/internal/**` и `src/core/discord/**` запретить импорт `../index` (защита от цикла на фасаде).

Дополнительно: простой CI/скрипт, который сканирует импорты в `src/modules/**` и падает, если найден путь в core, отличный от `core/index`. (Аналог one-level import rule у MUI.)

### 3.6. Скрытие internals из типов и документации

- `stripInternal: true` (на будущее, при выпуске `.d.ts`) + `/** @internal */` на `Bot`, `Registry`, `Pipeline`, `FileStore`, `createLogger` и т.д.
- `docs:api` (typedoc): сузить `--entryPoints src/core/index.ts` и добавить `--exclude '**/internal/**'`/`--exclude '**/discord/**'`, чтобы документация отражала только публичный контракт (соответствует ADR-0006 «documentation as first-class»).

### 3.7. Naming — зафиксировать в глоссарии (CONTEXT.md)

- **Core** — публичный контракт: `src/core/index.ts` + публичные типы/фабрики (`defineModule`, `defineHandler`, `arg`, `Result`, `Input`, …). Стабилен, документирован, семвер.
- **Internal** — реализация контракта: `src/core/internal/` (`Registry`, `Pipeline`, store/logger/config). Не стабилен, модулям недоступен.
- **Host** — wiring: `src/core/discord/` + `Bot` (composition root, импортируется только из `src/index.ts`). Единственное место runtime-discord.js.
Переименование `core`→`framework` не требуется (выигрыш не стоит churn ADR-ов и доков); достаточно подпапок + фасада.

### 3.8. Держать «package-ready» форму (ADR-0004)

Проектировать так, чтобы потом публичный контракт экспортировался по одному пути (`@ds/core`), а внутренности не попадали в `package.json exports` — тогда deep-import внутренностей станет физически невозможен. Сейчас это заменяет eslint-правило из 3.5.

### 3.9. Обновить `docs/guides/module-api.md`

Зафиксировать: «единственная точка входа — `import { ... } from '../../core/index.ts'`; список доступных символов (3.1); `Bot`/`Registry`/`Pipeline`/`FileStore` недоступны модулям». Это снимает неопределённость «что можно трогать» для контрибьютора.

---

## Итог (кратко)

1. `core/index.ts` — курируемый фасад, без `export *`, только контракт (3.1).
2. Реализация → `src/core/internal/`; discord → `src/core/discord/` (3.2).
3. В контрактной части `core` — ноль runtime-импортов discord.js; конвертации Input/Result живут только в адаптере (3.3).
4. `Client` из публичного контракта — в escape-hatch/`internal` (3.4).
5. eslint `no-restricted-imports` / `import/no-internal-modules` + CI-проверка импортов модулей (3.5).
6. `@internal` + `stripInternal` + сузить typedoc (3.6).
7. Термины Core/Internal/Host в CONTEXT.md (3.7); package-ready `exports` (3.8); обновить `module-api.md` (3.9).

## Источники

- [TypeScript Handbook: Modules](https://www.typescriptlang.org/docs/handbook/2/modules.html)
- [RuneHub: Barrel Files in TypeScript](https://rune.codes/hub/typescript/barrel-files-in-typescript)
- [Marc Nuri: What are Barrel Exports in JavaScript and TypeScript?](https://blog.marcnuri.com/barrel-exports-javascript-typescript)
- [PViz: TypeScript Module Boundaries — Barrel Files vs Clean Module Boundaries](https://pvizgenerator.com/blog/typescript-module-boundaries)
- [kindatechnical: Path Aliases and Barrel Exports](https://kindatechnical.com/typescript/path-aliases-barrel-exports.html)
- [Feature-Sliced Design: Rollup.js library architecture](https://feature-sliced.design/blog/rollup-library-architecture)
- [Kyle Shevlin: Facade Pattern](https://kyleshevlin.com/facade-pattern/)
- [Medium: The Facade Pattern in Modern JavaScript](https://medium.com/@artemkhrenov/the-facade-pattern-in-modern-javascript-simplifying-complex-systems-df4de098529b)
- [Generalist Programmer: Hexagonal Architecture + TypeScript](https://generalistprogrammer.com/tutorials/hexagonal-architecture-complete-guide)
- [ArchMan: Hexagonal Ports and Adapters](https://archman.dev/docs/architectural-styles/hexagonal-ports-and-adapters)
- [SO: Typescript library — Hide internal exports (`stripInternal`)](https://stackoverflow.com/questions/59122428)
- [TSDoc: @internal](https://tsdoc.org/pages/tags/internal/)
- [eslint: no-restricted-imports](https://eslint.org/docs/latest/rules/no-restricted-imports)
- [eslint-plugin-import: no-internal-modules](https://github.com/import-js/eslint-plugin-import/blob/master/docs/rules/no-internal-modules.md)
- [Frontend Interview: package.json exports + Types](https://www.frontendinterview.in/blog/typescript-package-exports-and-types)
- [mui/material-ui AGENTS.md](https://github.com/mui/material-ui/blob/master/AGENTS.md) (внутренние пакеты `@mui/internal-*`)
- [ReadOSS: Material UI package dependency pyramid](https://readoss.com/en/mui/material-ui/material-ui-internals-architecture-package-dependency-pyramid) (one-level import rule)
- [lit: lit-localize.ts (`internal/`)](https://github.com/lit/lit/blob/main/packages/localize/src/lit-localize.ts)
- [apify/crawlee: `src/index.ts` с `./internals/*`](https://github.com/apify/crawlee/blob/master/packages/utils/src/index.ts)
- [PaddleHQ/paddle-node-sdk: фасад с `./internal/index.js`](https://github.com/PaddleHQ/paddle-node-sdk)
- [sapphiredev/framework: `src/index.ts`](https://github.com/sapphiredev/framework/blob/main/src/index.ts)
- [spraxium: разбиение core/common](https://spraxium.com/en)
