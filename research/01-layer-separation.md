# 01. Разделение слоёв в TypeScript-фреймворке бота

Дата: 2026-08-03
Статус: исследование (не ADR). Вопрос: как правильно разделить «контракт» и «реализацию» в `src/core`, убрать god-object `bot.ts` и не дать модулям видеть internals.

---

## Текущие проблемы

Проект уже сделал половину правильной работы (порты `Store`, `ChannelMemory`, `Logger` в `types.ts`, ADR-0003 про изоляцию модулей по публичному API), но слои смешаны:

1. **`src/core/bot.ts` — god-object (299 строк).** В одном классе сцеплены 6 ответственностей:
   - discovery + Enable-резолюция (`registry.discover`, `resolveEnabledModules`, `validateOptions`);
   - жизненный цикл (`runSetup`, `onReady`, `shutdown`);
   - inbound-adapter: `onInteraction` читает `ChatInputCommandInteraction` и мапит его в `Input` (`toInput`, `preconditionEnv`, `grantedCapabilities`);
   - оркестрация гейтов: вызов `pipeline.checkPreconditions` и (отдельно!) `pipeline.missingCapabilities`;
   - outbound-adapter: `resultToPayload` + `reply` (конвертация `Result` → discord-пейлоад);
   - владение discord-клиентом и `syncCommands`.
   Capability-гейт `missingCapabilities` физически живёт в `pipeline.ts`, но вызывается из `bot.ts` отдельным шагом — тестировать «предусловия + capability» как одно целое нельзя без мока discord.js.

2. **Утечки discord.js в контрактное ядро** (ядро не порт, раз оно знает про discord.js):
   - `types.ts:1` — `Result.embed: EmbedData` импортирован из `discord.js` (`EmbedData` умеет `EmbedBuilder`-нормализацию, которую ядро и не должно знать);
   - `module.ts:1` — `ModuleReadyContext.client: Client` отдаёт модулю весь discord-клиент. Модуль `help` этим пользуется: хранит `clientRef` в модульном глобале и лезет в `client.application.commands.fetch()` в обход абстракций Input/Result (src/modules/help/module.ts:4-24);
   - `args.ts:2` — `ApplicationCommandOptionType` из discord.js в схеме аргументов ядра.

3. **`src/core/index.ts` — barrel-файл, экспортирующий всё подряд**, включая internals: `Bot`, `Registry`, `Pipeline`, `FileStore`, `InMemoryChannelMemory`, `MemoryStore`, `createLogger`, `toDiscordOptions`, `capabilityLabel`. Модули (`src/modules/*/module.ts`) импортируют именно `../../core/index.js` и технически могут тянуть что угодно из ядра. Нет разницы между «публичный контракт для модулей» и «внутренности ядра».

4. **`Result` уже почти чистый** (message/embed/attachment/multiple), но доставка и проверка прав доставки (`grantedCapabilities`) — про discord-объекты, и этот код невыделяем для юнит-теста без discord.js.

5. **Диалоговая память и store-фабрикация** (`runSetup` создаёт `new FileStore` внутри `Bot`) — подмена на `MemoryStore` в тестах требует класс-флагов, а не состава по dependency injection.

---

## Best practices (с источниками)

### 1. Публичный API = явный фасад, а не barrel с `export *`

- SAP Cloud SDK (ADR 0028 «Public API extraction»): каждый объект обязан относиться к одной из категорий — **public API** (стабильный контракт, попадает в `index.ts`), **internal API** (`@internal` + `stripInternal`, отдельный под-экспорт) или **не экспортируется вообще**. Root `index.ts` собирается вручную, без `export *`. Источник: https://github.com/SAP/cloud-sdk-js/blob/main/knowledge-base/adr/0028-public-api-extraction.md
- Arrange Act Assert («Building TypeScript Libraries», 2025): **явные именованные re-export-ы — рекомендованный подход** — tree-shaking, отсутствие коллизий, читаемый публичный API, защита от циклических импортов; работает с `verbatimModuleSyntax` (в проекте уже включён). Источник: https://arrangeactassert.com/posts/building-typescript-libraries/
- PViz («Module Boundaries: Barrel vs Clean Architecture», 2026): ключевая развилка — **barrel (выкачивает всё) vs API facade (только намеренный публичный API)**. `export *` превращает внутренние хелперы в публичный контракт — «API drift»; потом нельзя рефакторить без страха. Источник: https://pvizgenerator.com/blog/typescript-module-boundaries
- Feature-Sliced Design («Public API rule on slices»): «Модули вне слайса могут ссылаться только на публичный API, никогда на внутреннюю структуру файлов». Реализация — один `index.ts` со **явными** re-export-ами на слайс. Источник: https://feature-sliced.design/docs/reference/slices-segments#public-api-rule-on-slices
- Оговорки про баррели: Atlassian удалила баррели ради −75% времени сборки — баррель заставляет компилятор/бандлер разбирать весь граф зависимостей при импорте одной функции; для внутреннего кода «инкапсуляция» баррелей стоит дороже, чем пользы. Источник: https://www.atlassian.com/blog/atlassian-engineering/faster-builds-when-removing-barrel-files
- FSD-правило `no-layer-public-api`: **не должно быть layer-level `index.ts`** (кроме точки входа приложения). Слой `core` = один слайс ⇒ один узкий фасад; вложенных баррелей (`core/discord/index.ts` и т.п.) делать не надо. Источник: https://github.com/feature-sliced/steiger/tree/master/packages/steiger-plugin-fsd/src/no-layer-public-api

### 2. Hexagonal / ports-and-adapters подходит для бот-фреймворка, но с нюансом

- Принцип: **стрелки зависимостей смотрят внутрь** — `domain ← application ← infrastructure`; `domain` не знает про Express/discord.js/Prisma. Порты (интерфейсы) — в ядре, адаптеры (реализации) — снаружи. Типичная структура: `domain/model`, `domain/port/{in,out}`, `application/usecase`, `adapter/in/http`, `adapter/out/persistence`, `config/container.ts` (только wiring). Источник: https://github.com/marvinrichter/clarc/blob/main/skills/hexagonal-typescript/SKILL.md
- Подтверждённые примеры структуры: `domain` (чистая логика, ноль фреймворков) / `application` (usecases, порты) / `infrastructure` (адаптеры) / `app` (bootstrap). Источники: https://github.com/pasaperez/hexagonal-backend-template-ts , https://github.com/garudaidr/clean-architecture-example
- **Для бота:** discord.js — это одновременно inbound-adapter (событие `interactionCreate` → нормализованный вызов) и outbound-adapter (регистрация команд + доставка ответа). «Домен» бота — правила обработки команд: `Input → (preconditions + capabilities) → Handler → Result`. Пока `Result` содержит discord-тип `EmbedData` и `onReady` отдаёт `Client`, ядро не изолировано от фреймворка — это нарушение Dependency Rule.
- Как делают в реальных проектах: домен оборачивает discord-клиент в узкий порт. Примеры: `interface DiscordClient { getMe(), sendMessage(...) }` в Open-Curiosity/gini-agent (https://github.com/Open-Curiosity/gini-agent/blob/main/packages/runtime/src/integrations/discord.ts); `interface DiscordClient { destroy() }` в MonitoRSS (https://github.com/synzen/MonitoRSS/blob/main/services/bot-presence/src/discord-client.ts).

### 3. Composition root: убрать god-object, а не спрятать его в контейнер

- Martin Fowler («Dependency Composition»): DI — это решение про то, **где заканчивается конструирование и начинается поведение**; не про фреймворк. Частичное применение (factory = `createThing(deps)`) держит модули независимыми. Источник: https://martinfowler.com/articles/dependency-composition.html
- Arrange Act Assert («Composition roots and fn(args, deps)»): сигнатура `fn(args, deps)` — args = вход вызова, deps = коллабораторы. Всё, что «разговаривает с миром» или отличается по средам, передаётся через deps; чистые хелперы — обычный import. Composition root собирает систему один раз на краю приложения (`main.ts`). Источник: https://arrangeactassert.com/posts/composition-roots-and-fn-args-deps/
- The T-Shaped Dev («DI in Node/TS. Part nobody teaches you»): **ручной DI + composition root покрывает 90% приложений**; контейнер (tsyringe/Inversify) нужен при 20-30+ сервисах. `module.mock()` — симптом скрытых зависимостей. Источник: https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you
- Тезис «ручной wiring без магии» подтверждает hexagonal-backend-template-ts: «manual dependency wiring, without a magic container».
- Альтернатива, реально используемая в discord-фреймворке: **Sapphire Framework** декомпозирует `SapphireClient` через систему плагинов с фазами хуков (`PreGenericsInitialization → PreInitialization → PostInitialization → PreLogin → PostLogin`) и «store»-ы для команд/прекондиций/листенеров; сам клиент остаётся тонким оркестратором загрузки. Это подтверждает: жизненный цикл бота должен быть **делегирован фазам**, а не лежать одной простынёй. Источник: https://github.com/sapphiredev/framework/blob/bba782cede16e50e698faee17c3db41b9daba537/src/lib/SapphireClient.ts
- Fastify: образцовая модель **изоляции плагинов** — каждый `register()` создаёт дочерний контекст (encapsulation): декорторы/хуки видны потомкам, но не сиблингам и предкам; общие вещи (db, logger) — в корневой scope или через `fastify-plugin` с декларацией зависимостей/версий. Прямая аналогия с вашими модулями: модуль должен получать ровно то, что объявил, а не общий `Client`. Источники: https://fastify.dev/docs/latest/Reference/Plugins/ , https://github.com/fastify/fastify-plugin#dependencies , https://github.com/fastify/fastify/blob/main/docs/Reference/Encapsulation.md

### 4. Инфраструктура под интерфейсом

- Регистрация slash-команд у вас **уже** адаптер (`toSlashCommand`/`syncCommands` в `src/core/discord/registrar.ts`) — это правильно. Проблема только в том, что он лежит внутри `core/` и зовётся из god-object.
- Чтобы ядро не знало discord.js, **схема аргументов должна быть нейтральной**, а маппинг в `SlashCommandBuilder` — только в адаптере. Сейчас `args.ts` хранит `ApplicationCommandOptionType` в ядре.
- `Result` должен нести сериализуемые данные (plain JSON embed), а превращение в `APIEmbed`/`Buffer` — происходить в outbound-адаптере (сейчас `toApiEmbed`/`resultToPayload` спрятаны в `bot.ts`).

### 5. Не пускать internals в публичный импорт модулей

- FSD предлагает готовые linter-правила: `fsd/public-api` (требует публичный API у слайса), `no-public-api-sidestep` (запрет импорта из внутренних файлов слайса в обход фасада). Реализация — Steiger (https://github.com/feature-sliced/steiger) и `@feature-sliced/eslint-config` (https://github.com/feature-sliced/eslint-config).
- Для произвольной архитектуры — **`eslint-plugin-boundaries`** (`boundaries/dependencies` + `boundaries/entry-point`): типы элементов + политика зависимостей, включая «можно импортировать только через entry point элемента». Источник: https://www.jsboundaries.dev/docs/rules/
- Классика `no-restricted-imports` в больших проектах (sentry: `no-restricted-imports` + `plugin/boundaries`; Uniswap; vben-admin) — запрет импортов по glob/пути для внешних и внутренних модулей. Источник: https://github.com/getsentry/sentry/blob/master/eslint.config.ts
- Для будущего npm-пакета: `package.json` `exports` + `stripInternal`/`@internal` (TypeScript #58250). В in-repo варианте достаточно фасада + линт-правил.
- Fowler про границу типов: **типы не должны разлетаться между модулями без нужды** — лучше локальный дубликат типа на границе, чем общий тип, который цементирует связь. Источник: https://martinfowler.com/articles/dependency-composition.html

---

## Конкретные рекомендации для этого проекта

Ниже — план перестройки, согласованный с уже принятыми ADR (0003 «изоляция модулей по публичному API», 0005 «slash-команды — first-class surface», 0001 «capability как право канала»). Целевая картина:

```
src/
  core/contracts/   # «домен» бота: чистые типы и интерфейсы, НОЛЬ discord.js
  core/engine.ts    # чистая оркестрация: Input → (preconditions + capabilities + run) → Result
  core/discord/     # adapters: gateway.ts (Interaction→Input), deliver.ts (Result→payload), registrar.ts
  core/index.ts     # ЕДИНСТВЕННЫЙ узкий фасад для модулей
  start.ts          # composition root: wiring без логики
  modules/          # импортируют только фасад core/index.ts
```

1. **Выделить `core/contracts/` — слой чистых типов (домен).** Перенести в него и сделать свободными от discord.js: `Input`, `Result`, `Store`, `ChannelMemory`, `Logger`, `Capability`/`CHANNEL_CAPABILITIES`, `PreconditionSpec`/`PreconditionContext`/`PreconditionEnv`, `HandlerDef`, `ModuleDef`. Обоснование: правило зависимостей hexagonal (CLARC; pasaperez) — ядро не импортирует фреймворк. Это также напрямую разовьёт ADR-0003: модули уже зависят от публичного API ядра, и пусть этот API будет по-настоящему нейтральным.

2. **Убрать discord.js из контрактных типов:**
   - `Result.embed: EmbedData` → plain-тип (например `{ title?, description?, color?, fields: {name,value,inline?}[], ... }`). Маппинг в `APIEmbed` — только в `core/discord/deliver.ts`.
   - `args.ts` → нейтральный `'string' | 'integer' | 'number' | 'boolean' | 'enum'`; `ApplicationCommandOptionType` перенести в маппер `core/discord/registrar.ts`. Обоснование: ADR-0005 закрепляет slash как first-class, но тип схемы и её discord-представление — разные слои.

3. **Убрать `Client` из `ModuleReadyContext`.** Вместо `client: Client` дать модулям узкие порты по необходимости (например `commands: { fetch(): Promise<{name, description}[]> }` для `help`). Обоснование: модуль `help` сегодня лезет в `client.application.commands.fetch()` через модульный глобал (src/modules/help/module.ts:4-24) — это обход Input/Result и прямая связь с discord.js. Fastify-принцип encapsulation: модуль получает ровно объявленное.

4. **Разнести god-object `bot.ts` на три коллаборатора + composition root:**
   - `core/engine.ts` — чистая логика: `run(input, ctx, env)` = preconditions → capability-гейт → parseArgs → handler.run → Result. Capability-гейт (`missingCapabilities`) уже в `Pipeline` — втянуть его внутрь одного гейта, чтобы юнит-тесты покрывали «предусловия + права канала» без discord.js (убрать ручной вызов из `bot.ts`).
   - `core/discord/gateway.ts` — inbound adapter: владеет `Client`, слушает `interactionCreate`, мапит Interaction → `Input`, `PreconditionEnv`, `Set<Capability>` (перенести `toInput`/`preconditionEnv`/`grantedCapabilities` из `bot.ts`). Эти три функции сделать чистыми, возвращающими plain-данные.
   - `core/discord/deliver.ts` — outbound adapter: `resultToPayload` + `reply` (перенести из `bot.ts:239-297`), покрыть тестами отдельно.
   - `start.ts` — composition root: `createServices(config)` собирает logger/store-factory/engine/gateway/registrar и вызывает `start()`; сигнатуры `fn(args, deps)` по Fowler/ArrangeActAssert. Обоснование: «ручной wiring, composition root» — выбранный 2026 паттерн без магии и контейнеров (The T-Shaped Dev: покрывает 90%).

5. **Капабилити-проверка и precondition-env — чистые функции.** `mapInteractionToEnv(interaction): PreconditionEnv` и `grantedCapabilities(interaction): Capability[]` возвращают данные; оркестрация решает. Обоснование: ADR-0001 сузил Capability до «права в канале» — это дискорд-специфичное чтение прав, оно должно быть выделяемо и тестируемо (сейчас зашито в `bot.ts:204-237`).

6. **Store-фабрикация через deps, а не `new FileStore` в конструкторе.** `createStore(moduleName, dataDir): Store` в composition root; тесты подставляют `MemoryStore`. `Store` — уже порт, `FileStore`/`MemoryStore` — адаптеры; осталось перестать жёстко создавать `FileStore` внутри `Bot` (`bot.ts:124`).

7. **Сделать `core/index.ts` узким фасадом.** Публичное для модулей: `defineModule`, `defineHandler`, `arg`, и контрактные типы. Internals (`Bot`, `Registry`, `Pipeline`, `FileStore`, `MemoryStore`, `createLogger`, `toDiscordOptions`, gateway/deliver) — либо в `core/internal.ts`, либо просто не экспортировать; их импортирует только composition root. Обоснование: SAP ADR-0028 (категории экспортов, ручной `index.ts` без `export *`), PViz (facade vs barrel), FSD public-api rule.

8. **Запретить модулям импортировать internals линтом.** Добавить ESLint (или oxlint/Biome) с `no-restricted-imports` на `src/modules/**`, запрещающим `*/core/bot.ts`, `*/core/pipeline.ts`, `*/core/registry.ts`, `*/core/discord/*`, `*/core/store.ts`, `*/core/logger.ts` — остаётся только `*/core/index.js`. Более мощно — `eslint-plugin-boundaries` с элементами `contracts/core/adapters/modules` и политикой «modules → только facade», «core → без discord.js», «adapters → discord.js разрешён». Обоснование: sentry/Uniswap практика; boundaries/entry-point правило.

9. **Без лишних вложенных баррелей.** Один фасад `core/index.ts`; не создавать `core/discord/index.ts`, `contracts/index.ts` и т.п. (FSD `no-layer-public-api`, Atlassian про баррели). Внутри `core/` — относительные импорты конкретных файлов.

10. **Оформить как ADR-0007** («Core как порты и адаптеры; фасад как единственный импорт модулей») и обновить `docs/guides/module-api.md`, если перестройка принята — проект уже делает документацию first-class (ADR-0006), это удержит контрибьюторов от регрессий к god-object.

Порядок внедрения (безопасный, инкрементальный): (7)+(8) фасад+линт → (2) чистые типы Result/args → (4) выделение `deliver.ts`/`gateway.ts` из `bot.ts` с тестами → (1) `engine.ts` с единым гейтом → (3) узкий порт для `help` → (6) store-фабрикация → (10) ADR.
