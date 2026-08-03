# Composition Root и Wiring без DI-контейнера

**Дата:** 2026-08-03
**Статус:** исследование (не внедрено)
**Контекст:** [ADR-0001 — 0006] описывают модель Bot/Module/Handler/Input/Result/Capability/Precondition/Store/Registry/Enable. Ядро уже разделяет доменные типы (`types.ts`) от Discord-API. Проблема — `src/core/bot.ts` остаётся «god object»: одна точка сборки, но при этом сама содержит всю логику.

---

## Текущие проблемы

Файл `src/core/bot.ts` (299 строк) совмещает 7 ответственностей:

| Ответственность | Где сейчас |
|---|---|
| Discovery + Enable-разрешение + валидация опций модулей | `start()` L68, `resolveEnabledModules()` L96, `validateOptions()` L112 |
| Создание инстансов модулей (`setup`, `FileStore`, память) | `runSetup()` L122 |
| `onReady` модулей | `onReady()` L131 |
| Жизненный цикл Discord-клиента (login, регистрация команд, destroy) | `start()` L67-90, `shutdown()` L246 |
| Маршрутизация interaction → Handler (Interactor) | `onInteraction()` L144 |
| Перевод interaction → `Input` | `toInput()` L187 |
| Извлечение прав: предусловий и Capability из Discord | `preconditionEnv()` L204, `grantedCapabilities()` L218 |
| Present: `Result` → reply-пайлоад + доставка | `reply()` L239, `resultToPayload()` L259 |

Следствия god-объекта:

1. **`Bot` знает и Discord API, и домен.** `toInput`, `preconditionEnv`, `grantedCapabilities`, `resultToPayload` тянут `ChatInputCommandInteraction`, `PermissionFlagsBits`, `ChannelType` в класс, который должен быть «композиционным корнем». Это ломает направление зависимостей: домен (core) завязан на адаптер (discord.js).
2. **Нет единого состава приложения.** Композиция размазана по классу: инстансы создаются в конструкторе/методах, но их создание смешано с логикой каждого шага.
3. **Сложно тестировать по частям.** Нельзя протестировать маршрутизацию без реального `Client`; Presenter и CapabilityResolver не выделены как модули.
4. **`reply()` не различает replied/deferred** — fallback `followUp` ловится только как ошибка от `reply`. Официальный паттерн discord.js идёт иначе: проверять `interaction.replied || interaction.deferred` **до** вызова.
5. **Границы ошибок не полны.** Есть try/catch на `onInteraction`, но нет глобальных `unhandledRejection` / `Events.ShardError` (рекомендуется discord.js guide).

---

## Паттерны composition root (с источниками)

### Что такое composition root в Node-мире

Определение (единое у всех источников): **composition root — это единственное место на старте приложения (обычно `src/index.ts` / `main.ts` / `container.ts`), где создаются конкретные зависимости и связываются между собой.** Всё остальное в коде только *объявляет*, что ему нужно (конструкторы/аргументы функций), но не знает, какие конкретно реализации получит.

- «Composition root is the one place in your application where concrete things are created and wired together» — https://www.nazarboyko.com/articles/dependency-injection-in-nodejs-applications
- «Dependency injection is not about passing objects around. It is about separating construction from behavior. … Infrastructure is assembled once. Business behavior does not construct its own dependencies.» — https://www.echooff.dev/blog/dependency-injection-without-frameworks-in-typescript
- «The composition root is where the wiring happens … fn(args, deps) does not mean manually passing dependencies through every layer forever. The application satisfies those dependencies at the edge.» — https://arrangeactassert.com/posts/composition-roots-and-fn-args-deps/
- Направление импортов: «imports flow inward. Route handlers import from the composition root. The composition root imports concrete implementations. Services import nothing — they only depend on interfaces passed to them.» — https://www.kibadist.com/blog/dependency-injection-typescript-without-framework
- Martin Fowler's follow-up на тему «Dependency Composition»: частичное применение (factory-функции, получающие deps и возвращающие функцию) как механизм внедрения контекста в модули; идеальный компромисс между ручным DI и контейнерами. — https://martinfowler.com/articles/dependency-composition.html
- Практика миграции с Service Locator (антипаттерн) на composition root: класс-фасад, который «implemented every interface under the sun» и прятал реальные зависимости, заменяется честными конструкторами; в composition root также подписываются event-слушатели для развязывания циклических зависимостей. — https://www.itsnothing.de/post/from-service-locator-to-composition-root/
- Рецепт структуры для ручного DI: `domain/` (только типы, 0 импортов), `infra/` (реализации), `services/` (логика, зависит от интерфейсов domain), `routes/` (получает сервисы аргументами), `composition-root.ts` (собирает всё), `main.ts` (точка входа). — https://www.kibadist.com/blog/dependency-injection-typescript-without-framework

### Два практических приёма ручного DI

1. **`fn(args, deps)`** — функция принимает сначала входные данные, затем набор коллабораторов. Для инфраструктуры — маленькие `makeX()`-фабрики. При необходимости зависимости биндятся один раз: `makeCreateUser(deps) => (args) => createUser(args, deps)`. — https://arrangeactassert.com/posts/composition-roots-and-fn-args-deps/
2. **`buildContainer(config)`** — функция возвращает типизированный объект `Container = { db, mail, userService, ... }`; `index.ts` становится крошечным: `loadConfig → buildContainer → createServer(container)`. Тесты используют `buildTestContainer(overrides)`. Это «hand-rolled DI», который «scales surprisingly far». — https://www.nazarboyko.com/articles/dependency-injection-in-nodejs-applications

Триггеры для перехода на контейнер (иначе ручной DI достаточно):
- 20–30+ сервисов и громоздкий composition root;
- request-scoped зависимости (per-request logger/транзакция/контекст);
- разросшаяся условная сборка (switch на конфиг);
- **плагинная система, где третьи стороны регистрируют сервисы, а правка центрального файла нежелательна.**

— https://www.nazarboyko.com/articles/dependency-injection-in-nodejs-applications, https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you

### Ручной DI vs контейнер в 2026

Состояние рынка (2026): inversify ~1.5M загрузок/нед, tsyringe ~600K, awilix ~400K.

| | InversifyJS | TSyringe | Awilix |
|---|---|---|---|
| Декораторы | да | да | нет |
| `reflect-metadata` | нужен | нужен | не нужен |
| Авто-wire | нет | нет | по именам параметров |
| Совместимость с esbuild/SWC/Bun | нет (нужен shim) | нет | да |

Ключевой вывод 2026: `emitDecoratorMetadata` не поддерживается esbuild/SWC/Vite/Bun — а это доминирующие трансляторы Node. tsyringe/inversify требуют `experimentalDecorators` + `reflect-metadata` и ломаются в этих тулчейнах без доп. настроек. Awilix решает DI по именам параметров конструктора без метаданных и «works under Bun's native TypeScript execution». — https://www.pkgpulse.com/blog/inversifyjs-vs-awilix-vs-tsyringe-dependency-injection-2026

Тренд 2026: «the trend is away from full DI containers toward module-level singletons and dependency passing». Для приложений <10–15 классов сервисов контейнер добавляет сложность без выгоды. — https://www.pkgpulse.com/blog/inversifyjs-vs-awilix-vs-tsyringe-dependency-injection-2026

Принцип Awilix, релевантный для этого проекта: контейнер должен быть «прозрачен» для кода приложения — сервисы объявляют только свои зависимости и не знают о контейнере (низкая связанность = контрибьюторы не учат контейнер). — https://www.npmjs.com/package/awilix

**Вывод для `ds`:** ядро — ~10 классов, модули уже самодостаточны и получают зависимости через `setup`/`onReady`-контексты. Это «plugin system» в смысле Enable, но модули не регистрируют сервисы в граф — они объявляют Handler-ы и получают `{ store, memory, logger }`. Правка центрального файла при добавлении модуля НЕ требуется (дискавери по конвенции). Значит ручной DI + composition root — правильный выбор; контейнер не нужен. Если когда-то понадобится — только awilix (работает под Bun без декораторов).

### Как разбивать god-class на компоненты

Предложенное разбиение `Bot` соответствует устоявшимся паттернам (Ports & Adapters / Clean Architecture):

- **Adapter (DiscordAdapter)** владеет `interactionCreate`, делает только перевод и диспатч. Дискорд-знание изолируется от домена.
- **InputTranslator** = перевод `ChatInputCommandInteraction → Input` (порт входа).
- **Interactor / UseCase** = оркестрация: precondition → capability → `pipeline.run` → Present. Без знания Discord.
- **CapabilityResolver** = извлечение прав/окружения из Discord (порт).
- **ResultPresenter** = `Result → payload` + доставка (reply/followUp) — это Presenter из Clean Architecture.
- **SlashRegistrar** = синк команд (в `ds` уже есть `registrar.ts`, но вызывается из god-объекта).
- **Lifecycle** = старт/выключение в правильном порядке.

Реальные примеры в TS-ботах:

- **humeo/code-helm** (MIT, 2025): `toReplyOptions(result.reply)` (Result→payload) + `replyOrFollowUp(interaction, options)` с проверкой `interaction.replied || interaction.deferred` + `safelyDeferReply`. Ровно паттерн ResultPresenter. — https://github.com/humeo/code-helm/blob/main/src/discord/commands.ts
- **survev/survev** (GPL): `hasBotPermission(interaction)` и `sendNoPermissionMessage(interaction)` вынесены в utils/helpers; `setupInteractionHandlers()` отделяет регистрацию слушателя от логики. — https://github.com/survev/survev/blob/master/bot/src/index.ts
- **TraderAlice/OpenAlice** (AGPL): дискорд-адаптер делает `context.commands.execute({ connectorId, command, userId, ... })` — адаптер переводит interaction в доменный вызов, ядро о Discord не знает. — https://github.com/TraderAlice/OpenAlice/blob/master/services/connector/src/adapters/discord.ts
- **asrouji/DiscordJS-Typescript-Template**: слушатель `interactionCreate` тоньше 10 строк — он только диспатчит на `InteractionHandler.handle(interaction)`. — https://github.com/asrouji/DiscordJS-Typescript-Template

### Event-driven паттерны в discord.js

- Официальная схема: один `interactionCreate`-слушатель → type-guard (`isChatInputCommand()`) → поиск команды в `Collection` → `try/catch execute` → при ошибке: если `interaction.replied || interaction.deferred` → `followUp`, иначе `reply`, всегда ephemeral. — https://github.com/discordjs/guide/blob/main/guide/creating-your-bot/command-handling.md
- Предложение middleware API в ядро discord.js (#7190) **не принято**; пайплайн с `next()` остался предложением. Свой middleware-слой (типа гейт-цепочки Pipeline в `ds`) — нормальный DIY-подход. — https://github.com/discordjs/discord.js/issues/7190
- Практика для крупных ботов: один файл на событие, авто-регистрация через массив `{ name, once, execute }`. Каждый обработчик изолирован и тестируется независимо. — https://arnauld-alex.com/building-a-production-ready-discord-bot-architecture-beyond-discordjs
- OOP-фреймворк поверх discord.js (discord.ts-architecture) группирует обработчики по типам взаимодействий и подключает их одним вызовом `activateInteractionCreate(handler)`; исключения ловятся централизованно, есть авто-defer. — https://github.com/scorixear/discord.ts-architecture

### Обработка ошибок на границах

Три границы, которые стоит закрыть (discord.js guide + примеры):

1. **Граница команды** (внутри `execute`): try/catch; сообщение об ошибке — ephemeral; выбор `followUp` vs `reply` по флагу `replied/deferred`. — https://github.com/discordjs/guide/blob/main/guide/creating-your-bot/command-handling.md; реальные примеры: AtlantaBot (https://github.com/Androz2091/AtlantaBot/blob/master/src/events/interactionCreate.ts), muse (https://github.com/museofficial/muse/blob/master/src/bot.ts).
2. **Граница процесса**: `process.on('unhandledRejection')` — глобальный лог для ошибок, которые не пойманы явно. — https://github.com/discordjs/guide/blob/main/guide/popular-topics/errors.md
3. **Граница сети**: `client.on(Events.ShardError)` — лог проблем websocket/сети (ECONNRESET, ETIMEDOUT), не роняя бот. — https://github.com/discordjs/guide/blob/main/guide/popular-topics/errors.md

Shutdown: ресурсы закрываются в порядке, обратном созданию; в composition root подписываются и стопятся listener-ы (пример `container.close()` — https://oneuptime.com/blog/post/2026-01-26-nodejs-dependency-injection/view; event-координация в composition root — https://www.itsnothing.de/post/from-service-locator-to-composition-root/).

---

## Рекомендации для этого проекта

Целевая структура (ручной DI, без новых зависимостей):

```
src/index.ts                 # composition root: loadConfig → composeApp() → lifecycle.start()
src/app/
  compose.ts                 # buildContainer-функция: создаёт logger, registry, pipeline,
                             #   stores, memory, presenter, resolver, interactor, client
  lifecycle.ts               # Lifecycle: start()/shutdown() в правильном порядке
  interactor.ts              # InteractionInteractor: orchestration, без Discord-типов
src/discord/                 # адаптерный слой — единственный, кто импортирует discord.js
  adapter.ts                 # InteractionAdapter: interactionCreate → translate → interact → present
  input-translator.ts        # toInput (перенос из bot.ts L187)
  capability-resolver.ts     # grantedCapabilities + preconditionEnv (перенос L204-237)
  result-presenter.ts        # resultToPayload + reply/followUp (перенос L239-297)
  registrar.ts               # уже есть
```

1. **Сделать `src/index.ts` настоящим composition root.** Вынести сборку в `composeApp(config): AppContext` (или `buildContainer`). `Bot` перестаёт быть владельцем инстансов; он либо превращается в тонкий `Lifecycle`, либо удаляется. Принцип: только composition root знает конкретные реализации; остальное объявляет зависимости конструктором/аргументами. Источники: nazarboyko, echooff, kibadist.

2. **Выделить адаптерный слой и запретить ядру импорт discord.js.** Сейчас `bot.ts` импортирует discord.js напрямую. Перенести весь Discord-код (`toInput`, `grantedCapabilities`, `preconditionEnv`, `resultToPayload`, `reply`, создание `Client`) в `src/discord/*`. Домен (Interactor) работает только с `Input`, `Result`, `Store`, `ChannelMemory`, `Logger`. Это обратное направление импортов из рекомендации kibadist.com.

3. **`InteractionInteractor` — единственный оркестратор.** Перенос `onInteraction()` (bot.ts L144-185): найти handler → precondition → capability → `pipeline.run` → present. Он принимает зависимости (`registry`, `pipeline`, `presenter`, `resolver`, `stores`, `memory`, `logger`) и не знает про `Client`/`Interaction`.

4. **`InputTranslator` как отдельный модуль** (`toInput` из bot.ts L187). Чистая функция `interaction → Input`, покрыта юнит-тестами без discord.

5. **`CapabilityResolver` как отдельный модуль** (`grantedCapabilities` + `preconditionEnv`). Изолирует `PermissionFlagsBits`, `ChannelType`, `owners`. Пример-аналог: `hasBotPermission()` в survev/survev.

6. **`ResultPresenter` как отдельный модуль** (`resultToPayload` + `toApiEmbed` + доставка). Добавить проверку `interaction.replied || interaction.deferred` перед выбором `reply`/`followUp` (сейчас fallback лишь в `.catch`, и `followUp` кастуется через `as never`). Пример: `toReplyOptions` + `replyOrFollowUp` в humeo/code-helm.

7. **`Lifecycle` отдельно от маршрутизации.** `start()`/`shutdown()`: discovery → Enable → setup → login → sync → onReady; shutdown в обратном порядке. `onShutdown` модулей, `clearCooldowns`, `client.destroy`. Примеры порядка сборки/выключения: itsnothing.de, oneuptime.

8. **Тонкий event-listener.** В `adapter.ts` слушатель `interactionCreate` остаётся ≤10 строк диспатча (паттерн asrouji/discordjs guide): type-guard → translate → interact → present. Весь Discord-magic — в адаптере.

9. **Закрыть три границы ошибок.** (a) Команда: единый try/catch в Interactor, ephemeral-сообщение, выбор `followUp`/`reply` по флагу. (b) Процесс: `process.on('unhandledRejection', ...)` в `index.ts`. (c) Сеть: `client.on(Events.ShardError, ...)` в адаптере. Источник: discordjs guide popular-topics/errors.md.

10. **Без DI-контейнера.** Ядро ≈10 классов, модули самодостаточны, граф статичен на старте → ручной DI + composition root достаточно и лучше для контрибьюторов (не надо учить контейнер). Если потребность появится (динамическая регистрация сервисов третьими сторонами) — брать **awilix** (без декораторов, работает под Bun; tsyringe/inversify несовместимы с esbuild/SWC/Bun из-за `reflect-metadata`). Источник: pkgpulse 2026, awilix README.

### Что НЕ менять
- Модель `defineModule`/`defineHandler` и контексты `setup/onReady` — это уже готовый «внедрение на границе»: модуль получает `{ store, memory, logger }`. Сохранить.
- `Pipeline` как гейт-цепочка (precondition → capability → run) — соответствует принятому в сообществе DIY-middleware (discord.js #7190 не принял официальный middleware).
- API ядра для контрибьюторов (`src/core/index.ts`) не трогать; изменения внутренние.

### Порядок внедрения (трассировочные шаги)
1. Выделить `InputTranslator` + `CapabilityResolver` + `ResultPresenter` как чистые модули с тестами (без изменения поведения).
2. Ввести `InteractionInteractor`, перенести `onInteraction`-логику.
3. Переписать `Bot.start()/shutdown()` как `Lifecycle` с зависимостями из конструктора.
4. Вынести `composeApp()` в `src/index.ts`; `Bot`/`Lifecycle` больше не создаёт инстансы сам.
5. Добавить границы ошибок (unhandledRejection, ShardError, replied/deferred-check).

---
## Источники

- Nazar Boyko, «Dependency Injection in Node.js: From Args to NestJS» — https://www.nazarboyko.com/articles/dependency-injection-in-nodejs-applications
- Christian Rackerseder, «Dependency injection without frameworks in TypeScript» — https://www.echooff.dev/blog/dependency-injection-without-frameworks-in-typescript
- «Composition Roots and fn(args, deps)» (Arrange Act Assert) — https://arrangeactassert.com/posts/composition-roots-and-fn-args-deps/
- Max Ivashchenko, «Dependency Injection in TypeScript Without a Framework» — https://www.kibadist.com/blog/dependency-injection-typescript-without-framework
- Daniel Somerfield, «Dependency Composition» (martinfowler.com) — https://martinfowler.com/articles/dependency-composition.html
- Jan-Erik, «From Service Locator to Composition Root» — https://www.itsnothing.de/post/from-service-locator-to-composition-root/
- Petar Ivanov, «Dependency Injection in Node.js & TypeScript» — https://thetshaped.dev/p/dependency-injection-in-nodejs-and-typescript-dependency-inversion-part-no-body-teaches-you
- OneUptime, «How to Implement Dependency Injection in Node.js» — https://oneuptime.com/blog/post/2026-01-26-nodejs-dependency-injection/view
- PkgPulse, «InversifyJS vs Awilix vs TSyringe 2026» — https://www.pkgpulse.com/blog/inversifyjs-vs-awilix-vs-tsyringe-dependency-injection-2026
- Awilix README — https://www.npmjs.com/package/awilix
- discord.js Guide: command handling — https://github.com/discordjs/guide/blob/main/guide/creating-your-bot/command-handling.md
- discord.js Guide: errors (ShardError, unhandledRejection) — https://github.com/discordjs/guide/blob/main/guide/popular-topics/errors.md
- discord.js Middleware Proposal #7190 — https://github.com/discordjs/discord.js/issues/7190
- Real-world примеры (gh_grep): humeo/code-helm, survev/survev, TraderAlice/OpenAlice, Androz2091/AtlantaBot, museofficial/muse, asrouji/DiscordJS-Typescript-Template, scorixear/discord.ts-architecture, discordeno/discordeno
