# 03. Конвенции bun/TypeScript 2026 — структура и конфигурация проекта

Дата: 2026-08-03. Контекст: bun 1.3.11, TypeScript ~5.9, discord.js, VitePress. Вопрос: актуальные конвенции 2026 по структуре bun/TS-проектов и применимость к `ds`.

## Текущие проблемы

1. **`tsx` избыточен.** `package.json` использует `tsx watch src/index.ts` и `tsx src/index.ts`. Bun исполняет TS нативно (`bun src/index.ts`, `bun --watch`), поэтому `tsx` — лишняя зависимость и лишний слой. Всё, что нужно, даёт сам bun.
2. **`tsconfig.json` отклоняется от bun-эталона.** Проект ставит `"module": "ESNext"`; bun (и `bun init`) рекомендуют `"module": "Preserve"` + `"moduleDetection": "force"`. Не хватает `noFallthroughCasesInSwitch`, `noImplicitOverride`. Остальное уже верное: `moduleResolution: "bundler"`, `allowImportingTsExtensions: true`, `verbatimModuleSyntax: true`, `noEmit: true`, `types: ["bun"]`.
3. **Тесты не co-located.** `tests/pipeline.test.ts`, `tests/store.test.ts` и генератор пишут тесты модулей в `tests/modules/<name>.test.ts`. Для фреймворка с модулями удобнее класть тест рядом с кодом.
4. **Нет `bunfig.toml`.** Некоторые настройки тест-раннера и установщика не зафиксированы (coverage, pathIgnorePatterns, linker).
5. **README описывает устаревшую структуру** с `tests/` — после co-location его надо обновить.

## Конвенции bun/TS (с источниками)

### 1. Структура папок bun/Node TS-приложений 2026

Жёсткого стандарта нет; устоявшийся де-факто набор для однопакетного приложения:

- `src/` — исходники приложения (единственный каталог кода). «Всё, что исполняется, — в `src/`».
- `scripts/` — инструменты разработчика/генераторы, не входящие в рантайм приложения.
- `tests/` — либо отдельный каталог, либо (тренд 2026) co-located рядом с кодом (см. п. 5).
- `docs/` — документация (VitePress здесь: `docs/` + `docs/.vitepress/config.ts`).
- `bot.config.ts` — конфиг приложения на корне (типизированный, проверяется `tsc`).

Источники:
- [Bun — `bun init`](https://bun.com/docs/runtime/templating/init.md) генерирует минимальный каркас (`index.ts`, `tsconfig.json`, `package.json`) без предписанной структуры папок.
- [typescript.tv — Co-located Tests Scale Better, 2026-04](https://typescript.tv/best-practices/co-located-tests-scale-better/): «классическая» структура `src/` + отдельный `tests/` уходит в прошлое; папки называются по ответственности, не по типу; «keep folders shallow and named by responsibility, no `utils` dumping ground».
- [intzzzero.dev — How to Structure a Project for AI Coding Tools, 2026-06](https://intzzzero.dev/how-to-structure-a-project-for-ai-coding-tools): фичи (route + logic + test) co-locate в одном каталоге; `lib/` — только dependency-free общие хелперы.

Вывод для `ds`: структура уже соответствует тренду (`src/` = приложение, `scripts/` = инфраструктура, `docs/` = документация, конфиг на корне). Менять нужно только расположение тестов.

### 2. Bun conventions

**Запуск TS без сборки.** Bun транслирует и исполняет TS/TSX нативно — `bun index.ts`. Watch-режим: `bun --watch index.ts` (рестарт процесса при изменении). Никаких `ts-node`/`tsx`/сборки в dev не нужно. Реальные примеры: [create-elysiajs: `"dev": "bun --watch src/index.ts"`](https://github.com/kravetsone/create-elysiajs/blob/main/src/templates/package.json.ts), [modelcontextprotocol/ext-apps: `"serve": "bun --watch main.ts"`](https://github.com/modelcontextprotocol/ext-apps/blob/main/examples/integration-server/package.json). Источник: [Bun docs — Runtime](https://bun.com/docs/runtime/index.md).

**`.env`.** Bun читает `.env` автоматически, по возрастанию приоритета: `.env` → `.env.{NODE_ENV}` → `.env.local`; поддерживает подстановку (`FOO=world; BAR=hello$FOO`). Пакет `dotenv` не нужен. `dotenv`-файлы загружаются и для `bun test`. Отключить авто-загрузку (prod/CI): `--no-env-file` или `env = false` в `bunfig.toml`; явные `--env-file=` при этом работают. Доступ: `process.env` / `Bun.env` / `import.meta.env`. Типизация через interface merging:

```ts
declare module "bun" {
  interface Env {
    DISCORD_TOKEN: string;
  }
}
```

Источник: [Bun docs — Environment Variables](https://bun.com/docs/runtime/environment-variables.md).

**`bunfig.toml`.** Bun-специфичный конфиг в корне проекта (не путать с глобальным `~/.bunfig.toml`). Полезные секции: `[test]` (`preload`, `root`, `pathIgnorePatterns`, `coverage*`, `concurrentTestGlob`), `[install]` (`linker = "hoisted"|"isolated"`, `saveTextLockfile`, `frozenLockfile`), `[run]`, `env = false`, `telemetry = false`. Реальные примеры: [opencode `bunfig.toml`](https://github.com/anomalyco/opencode/blob/dev/packages/core/bunfig.toml), [oven-sh/bun `test/bunfig.toml`](https://github.com/oven-sh/bun/blob/main/test/bunfig.toml). Источник: [Bun docs — bunfig.toml](https://bun.com/docs/runtime/bunfig.md).

**`package.json` для bun-проекта.** Поля-маркеры:
- `"type": "module"` — проект ESM.
- `"packageManager": "bun@1.3.11"` — уже есть; это де-факто стандарт в крупных проектах (opencode, cline, onyx, GitbookIO, elizaOS — все pin `bun@x.y.z`).
- `"trustedDependencies": [...]` — для пакетов с postinstall-скриптами; если их нет, не нужен.
- `"$schema": "https://json.schemastore.org/package.json"` — автокомплит в редакторах.
- `"exports"`/`"main"` не нужны (приложение не публикуется; `bun` поддержал бы `"bun"`-условие, если бы это была библиотека).

Источники: [Bun docs — Lockfile](https://bun.com/docs/pm/lockfile.md), [Bun docs — Module Resolution](https://bun.com/docs/runtime/module-resolution.md) (раздел про `"bun"`-условие в `exports`), реальные `package.json` из [opencode](https://github.com/anomalyco/opencode/blob/dev/package.json), [onyx](https://github.com/onyx-dot-app/onyx/blob/main/package.json), [elizaOS](https://github.com/elizaOS/eliza/blob/develop/packages/elizaos/templates/project/package.json).

**`tsconfig.json` (bun-эталон, актуально для TS 5.8+ и обязательно для TS 6/7).**

```jsonc
{
  "compilerOptions": {
    "lib": ["ESNext"],
    "target": "ESNext",
    "module": "Preserve",           // вместо ESNext — позволяет импорты с .ts
    "moduleDetection": "force",
    "types": ["bun"],               // с TS 6.0 auto-discovery @types отключён — указывать явно
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true
  }
}
```

Ключевой сдвиг 2026: `"module": "Preserve"` — разрешает писать импорты с расширением `.ts` в рантайме bun и оставляет модули в исходном виде (подходит для нативного исполнения bun). `types: ["bun"]` обязателен явно начиная с TypeScript 6.0, иначе `Bun`/`Request` глобальные имена не резолвятся.

Источники: [Bun docs — TypeScript](https://bun.com/docs/typescript.md) (рекомендованный `compilerOptions`), [Bun docs — TypeScript 6 and 7](https://bun.com/docs/typescript-6.md) (обязательное `types: ["bun"]`).

**`bun test` vs vitest.** В проекте уже `"test": "bun test"` — это правильно для bun-рантайма: `bun test` находит тесты сам, без конфигурации, Jest-совместимый API, встроенный `--watch`, `--coverage`, `preload`. (Если бы использовали vitest — запускать через `bun run test`, иначе `bun test` запустит свой раннер; [vitest docs](https://vitest.dev/guide).) Для этого проекта vitest не нужен: рантайм bun, никакого Vite в рантайме, а VitePress-доки тестов не касаются. Источник: [Bun docs — Test runner](https://bun.com/docs/test/index.md).

**Discovery тестов.** `bun test` рекурсивно ищет `*.test.{js,ts,...}`, `*_test.*`, `*.spec.*` по всему проекту, исключая `node_modules` и скрытые каталоги. Фильтр по пути: `bun test utils`; корень меняется `[test] root` в bunfig. Пример из доков — co-located: `src/utils/string.test.ts`. Источник: [Bun docs — Finding tests](https://bun.com/docs/test/discovery.md).

**Алиасы.** Bun поддерживает и `tsconfig.json` `compilerOptions.paths`, и subpath imports в `package.json` (`"#core": "./src/core/index.ts"`); оба резолвятся редактором и рантаймом. Для контрибьюторов относительные импорты с `.ts` работают тоже, но `#`-алиасы сокращают путь `../../core/index.ts` до `#core`. Источник: [Bun docs — Module Resolution](https://bun.com/docs/runtime/module-resolution.md) (разделы «Path re-mapping», «Subpath imports»).

### 3. Конфигурация приложения (config file vs env)

Разделение де-факто по 12-factor:

- **env** — секреты и деплой-специфичное (`DISCORD_TOKEN`, `DISCORD_DEV_GUILD_ID`). Bun грузит `.env` сам; `.env.example` коммитится, `.env` — в `.gitignore`.
- **config file** (`bot.config.ts`) — структурные решения и Enable модулей, типизированные и валидируемые схемой модуля. Именно так и устроено в `ds`.

Подключение TS-конфига в bun: нативный динамический `import()` с cache-busting-суффиксом. Текущий код `src/core/config.ts:21-28` уже делает ровно это:

```ts
const url = `${pathToFileURL(configPath).href}?v=${Date.now()}`;
const loaded = (await import(url)) as { default?: BotConfig };
```

Это корректный bun-паттерн: bun исполняет импортируемый `.ts` без сборки; `?v=` обходит кэш модулей при повторной загрузке (важно для тестов и hot reload). Никакой tsx/доп. шагов не нужно. Источник: [Bun docs — Module Resolution](https://bun.com/docs/runtime/module-resolution.md) (нативная поддержка `import` TS-файлов) и код проекта.

### 4. «Проектная инфраструктура» vs «приложение»

Тренд 2026: каталоги называются по ответственности, мелкие по глубине; рантайм-код и инструменты разработки разделены.

- Приложение: `src/` (в `ds`: `src/core/` — ядро, `src/modules/` — модули).
- Проектная инфраструктура: `scripts/` (генератор `create-module.ts`), `docs/` (VitePress + ADR), `research/` (заметки), `CONTEXT.md`, `CONTRIBUTING.md`.
- Публичная поверхность для контрибьютора — только `src/core/index.ts` (баррель с `defineModule`/`defineHandler`/`arg`), модуль не знает про остальной `src/`. Это соответствует ADR-0003 (модуль изолирован публичным API).

Здесь проект уже корректен; отдельных каталогов `lib/`/`app/`/`config/` не требуется. `lib/` — удел библиотек, которые публикуют, или общих dependency-free хелперов; `config/` — когда конфигов несколько и они декларативные (здесь один типизированный `bot.config.ts` на корне, покрытый `tsc`).

### 5. Расположение тестов: co-located vs tests/

Тренд 2026 — **co-location для юнит/модульных тестов**, выделенный каталог — только для кросс-модульных интеграционных/E2E:

- [typescript.tv, 2026-04](https://typescript.tv/best-practices/co-located-tests-scale-better/): «Co-locating test files next to TypeScript source code beats a centralized “tests” folder every time» — мгновенный discovery, переживают рефакторинг (тест едет вместе с файлом), короткие относительные импорты (`./module.ts`, а не `../../src/modules/x/module.ts`), видна не покрытость, ясная зона ответственности. Гибрид: юнит рядом с кодом, интеграционные/E2E в корневом каталоге.
- [intzzzero.dev, 2026-06](https://intzzzero.dev/how-to-structure-a-project-for-ai-coding-tools): фича читается как одна единица (`auth.route.ts + auth.ts + auth.test.ts` в одном каталоге) — это же удобно для ИИ-агентов и контрибьюторов.
- Оба раннера поддерживают co-location из коробки: bun test discovery (`src/utils/string.test.ts` — [docs](https://bun.com/docs/test/discovery.md)), vitest по умолчанию (`**/*.{test,spec}.*`).
- Реальные bun-проекты используют оба паттерна: co-located (CodebuffAI: `common/src/testing/...`, `bun:test` рядом с кодом) и выделенный `test/` (opencode: `[test] preload = ["./test/preload.ts"]`).

**Для фреймворка с модулями (этот проект):** тест модуля должен жить в каталоге модуля — `src/modules/<name>/module.test.ts`, а тесты ядра — рядом: `src/core/pipeline.test.ts`, `src/core/store.test.ts`. Тогда «добавил модуль = добавил папку с module.ts + module.test.ts», ничего не теряется и не надо дублировать дерево. `tests/` оставить только если появятся интеграционные тесты, проверяющие несколько модулей сразу.

## Рекомендации для этого проекта

1. **Заменить `tsx` на нативный bun.** В `package.json`: `"dev": "bun --watch src/index.ts"`, `"start": "bun run src/index.ts"`, убрать `tsx` из devDependencies. `bun --watch` рестартует процесс при изменении (включая `bot.config.ts`).
2. **Выровнять `tsconfig.json` по bun-эталону:** `"module": "Preserve"` (вместо `ESNext`), добавить `"moduleDetection": "force"`, `"noFallthroughCasesInSwitch"`, `"noImplicitOverride"`. `moduleResolution: "bundler"`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `noEmit`, `types: ["bun"]` уже на месте.
3. **Перейти на co-located тесты:** `tests/pipeline.test.ts` → `src/core/pipeline.test.ts`, `tests/store.test.ts` → `src/core/store.test.ts`; обновить `scripts/create-module.ts`, чтобы писал тест в `src/modules/<name>/module.test.ts` (импорт по короткому `./module.ts`). Удалить каталог `tests/` либо оставить для будущих интеграционных тестов.
4. **Добавить `bunfig.toml`** в корень: например `[test] pathIgnorePatterns = ["docs/**", "scripts/**"]` и `coveragePathIgnorePatterns` при необходимости; при желании `[install] linker = "hoisted"`.
5. **Обновить README/CONTRIBUTING:** секция «Структура» — после co-location отразить тесты рядом с кодом; в контрибьюторском минимуме и так уже `bun test` — оставить.
6. **`config.ts` не трогать** — паттерн `import(url) + ?v=Date.now()` уже соответствует bun-конвенции загрузки TS-конфига.
7. **Опционально — алиасы:** добавить в `package.json` `"imports": { "#core": "./src/core/index.ts", "#core/*": "./src/core/*" }` (или `paths` в tsconfig), чтобы модулям не писать `../../core/index.ts`. Сначала решить, что важнее для контрибьютора: явный относительный путь или короткий алиас.
8. **Опционально — типизация env:** `declare module "bun" { interface Env { DISCORD_TOKEN: string } }` в `src/env.d.ts` (или в `src/core/types.ts`), чтобы `process.env.DISCORD_TOKEN` был `string`, а не `string | undefined`.
9. **Опционально — `package.json`:** добавить `"$schema": "https://json.schemastore.org/package.json"`; `"packageManager"` уже есть. `trustedDependencies` не нужен (discord.js/zod без postinstall).
10. **CI/prod:** запускать с `--no-env-file` (или `env = false` в bunfig на проде), полагаясь только на системные переменные.
