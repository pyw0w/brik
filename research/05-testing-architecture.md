# 05 — Архитектура тестирования

Исследование актуальных (2023–2026) практик тестирования Discord-ботов и Node-приложений на `bun test`, применённое к проекту `ds`. Дата исследования: 2026-08-03.

## Текущие проблемы

Прочитано: `tests/pipeline.test.ts`, `tests/store.test.ts`, `tests/modules/` (пусто), `src/core/*` (args, bot, config, handler, logger, module, pipeline, registry, store, types, discord/registrar), генератор `scripts/create-module.ts`, гайды.

1. **Дублирование тест-хелперов.** `baseCtx()` инлайном объявлена в `tests/pipeline.test.ts:5`, а генератор модулей вставляет свою копию `ctx()` в каждый созданный тест (`scripts/create-module.ts:43-55`). Бойлерплейт `new MemoryStore() + new InMemoryChannelMemory() + createLogger('test', 'error')` повторяется везде.
2. **Нет публичной тест-утилиты.** `MemoryStore` экспортируется из `src/core/index.ts`, но нет единой фабрики `Input`/`Context`/фейкового interaction. Контрибьютор обязан знать внутренние классы ядра, чтобы написать тест — противоречит главной ценности проекта («контрибьютор не понимает ядро»).
3. **Дыры в покрытии.** Нет тестов на: `args.ts` (`parseArgs`, `toDiscordOptions` — чистая логика, самый высокий ROI), `registry.ts` (discover, дубликаты), `config.ts` (ошибки loadConfig), `discord/registrar.ts` (`toSlashCommand`), и — главное — **весь discord-адаптер** `bot.ts` (`toInput`, `preconditionEnv`, `grantedCapabilities`, `resultToPayload`, `reply`). Модули `ping`/`roll`/`help` не имеют тестов; `tests/modules/` пуст.
4. **Discord.js не мокается вообще.** `BotOptions.syncSlashCommands: false` существует (src/core/bot.ts:27) именно для тестов, но ни один тест его не использует.
5. **Флейки по времени.** Тест cooldown в `pipeline.test.ts:81-92` зависит от реального `Date.now()` — потенциально недетерминирован (реальный проход занимает мс; при медленной машине возможен «хвост»).
6. **Приватная логика не тестируется из-за невозможности, а не из-за выбора.** `parseDice` в `src/modules/roll/module.ts:36` приватна — проверяется только «сквозь» `run()`. Это допустимо для поведения, но часть edge-case'ов (инвалидные формулы) проще покрывать через `Pipeline.run`, а не через приватную функцию.
7. **Нет CI и нет coverage.** `.github/` отсутствует; в `package.json` нет `bun test --coverage`. Для контрибьюторской модели минимальный CI-гейт (`bun test && bun run typecheck`) обязателен.

## Практики тестирования (с источниками)

### 1. Что тестировать: чистый core vs discord-адаптер

**Consensus сообщества discord.js/Sapphire:** мокать Discord API «по-настоящему» не стоит — извлекайте логику и тестируйте её отдельно от Discord.

> «Unit testing Discord bot's ... The consensus has always been to extract the code that you want to test and test it separately without the scope of Discord stuff.»
> — Discord.js/Sapphire community, AnswerOverflow (2024): https://www.answeroverflow.com/m/1213044049221521438

> «For unit testing you could simply create fake message / interaction objects with only those properties you require (I.e. create builders), pass them through a run function and assert the result.»
> — https://www.answeroverflow.com/m/1006925565565096006

**Ключевая идея 2026 года (фреймворк Warden):** тестируйте **реальный pipeline**, а не его упрощённую модель. `TestBot` поднимает весь фреймворк без Discord-соединения, `FakeInteraction` прогоняется через все middleware/gates, а ассерты идут по наблюдаемым свойствам interaction (`replied`, `lastReply`).

> «TestBot boots your entire framework — scanning decorated classes, wiring up the DI container, registering middleware — without connecting to Discord. This means your tests exercise the real pipeline, not a simplified mock of it.»
> — Warden Testing docs: https://getwarden.dev/advanced/testing/

**Kent C. Dodds — «Write tests. Not too many. Mostly integration.»** Интеграционные тесты дают лучший баланс «уверенность/скорость»; юнит-тесты нужны для сложной бизнес-логики, а не для каждого модуля в отрыве.
> «Integration tests strike a great balance on the trade-offs between confidence and speed/expense.»
> — https://kentcdodds.com/blog/write-tests

**Применительно к `ds`:** разделение уже сделано в архитектуре —
- **Чистый core** (`Pipeline`, `args`, `Store`, `Precondition`, `Handler`, `Registry`) — не зависит от discord.js в рантайме (импорт только `type EmbedData`). Это юнит-слой: быстрый, без токена.
- **Discord-адаптер** (`Bot.onInteraction` → `toInput` → gates → `reply`) — единственное место, где нужен фейк interaction. Тестировать его стоит **на границе**: фейковый interaction в реальный `Pipeline`, ассерт по Result/ответу — а не по внутренним методам.
- Ровно так же устроен «тест-характер»: `tests/pipeline.test.ts` уже прогоняет gates через реальный `Pipeline` — это правильный интеграционный стиль, надо только добавить адаптер.

### 2. Как фейкать/мокать discord.js без токена

**Доминирующий паттерн в реальных проектах — ручные фейки + каст `as unknown as T`** (не тяжёлые мок-библиотеки):

```ts
// museofficial/muse, tests/command-boundaries.test.ts
const interactionFor = (subcommand: string) => ({
  options: { getSubcommand: () => subcommand },
}) as unknown as ChatInputCommandInteraction;

// moonstar-x/discord-free-games-notifier, HelpCommand.spec.ts
const interaction = {
  reply: jest.fn(),
  locale: 'en-US'
} as unknown as ChatInputCommandInteraction;
```

**Фабрика-хелпер с `vi.fn()` и опциями по умолчанию** — самый чистый формат (xxczaki/discord-bot, `src/utils/testing/mockInteraction.ts`):

```ts
export function createMockInteraction(options = {}): ChatInputCommandInteraction {
  const { reply = true, getString = null, user, member, ... } = options;
  const interaction: Record<string, unknown> = {
    options: { getString: vi.fn().mockReturnValue(getString), getInteger: vi.fn() },
  };
  if (reply) interaction.reply = vi.fn().mockResolvedValue({});
  if (user) interaction.user = user;
  return interaction as unknown as ChatInputCommandInteraction;
}
```
— источник: https://github.com/xxczaki/discord-bot/blob/main/src/utils/testing/mockInteraction.ts

Продвинутая фабрика дополнительно отслеживает **состояние** (replied/deferred), чтобы ассертить жизненный цикл: https://github.com/jmiln/SWGoHBot/blob/master/test/mocks/mockInteraction.ts

**Ограничение:** у discord.js v13+ конструкторы классов приватные, `new ChatInputCommandInteraction()` невозможен. Обходные пути: `Reflect.construct()` (markkop/corvo-astral) либо, проще, — обычный объект + каст типа. Для наших целей каст достаточен: `Bot` в `bot.ts` обращается к interaction через `interaction.options.get`, `interaction.user`, `interaction.channelId`, `interaction.guildId`, `interaction.memberPermissions.has()`, `interaction.channel.nsfw`, `interaction.guild.members.me`, `interaction.reply/followUp` — всё это легко фейкается.
— про Reflect.construct: https://dev.to/heymarkkop/how-to-implement-test-and-mock-discordjs-v13-slash-commands-with-typescript-22lc

**Готовые мок-пакеты** (если не хочется писать своё):
- `discordjs-testing` — `MockChatInputCommandInteraction` с массивом `replies` и `typeCast()`: https://www.npmjs.com/package/discordjs-testing
- `@shoginn/discordjs-mock` — Reflect.construct-моки Client/Guild/User/Channel: https://www.npmjs.com/package/@shoginn/discordjs-mock

**Полноценная эмуляция API (2025–2026) для e2e** — если понадобится проверять реальные потоки (message/thread/reaction):
- `@robojs/mock` (2026) — локальный mock Discord Gateway + REST, сессии, запись действий: https://www.npmjs.com/package/@robojs/mock
- `discord-digital-twin` (2025) — локальный «твин» Discord API: https://github.com/remorses/kimaki/tree/main/discord-digital-twin
- `fauxcord` — stateful mock REST API v10: https://github.com/tomacheese/fauxcord

**Вывод:** для `ds` рекомендация — ручные фейки + фабрика в публичной тест-утилите. Тяжёлые эмуляторы не нужны, пока нет сложных e2e-сценариев.

### 3. Структура тестов: co-located vs `tests/`

Аргументы **за co-location** (`src/.../module.test.ts` рядом с кодом):
- Тест-гэпы видны сразу, тест и код путешествуют вместе, импорты тривиальны (`./module.ts`), тест переживает переименование директории (remarkablemark, JS Guide 2025).
> «Co-located tests are preferred in modern projects because they reduce friction and make missing tests visible.»
> — https://www.jsguide.dev/topic/testing-organization-structure
- Для компонентной/фичевой архитектуры юнит-тесты логично лежат с компонентом (Dom Habersack).

Аргументы **против** (ljharb, Enonic): инструменты (eslint-глобы, сборка, typecheck) могут не дружить с тестами в `src/`; тесты тип-чекаются как исходники.
> — https://github.com/airbnb/javascript/issues/1485; https://developer.enonic.com/learn/testing-with-jest-and-mock-xp/stable/colocation

**Для `ds` co-location безопасен:** нет шага сборки (`tsx` запускает исходники напрямую, `tsc --noEmit`), `tsconfig.json` уже включает и `src`, и `tests`; `Registry.discover` читает только `*/module.ts`, тестовые файлы в директории модуля игнорируются; `bun test` сам находит `*.test.ts` рекурсивно (игнорируя node_modules).

**Тонкость из практики:** для «node-модуля» (а наш core — это фреймворк-модуль) чаще держат всё в `tests/`, а интеграционные тесты — отдельно, т.к. они по определению покрывают несколько юнитов.
> — Corey Cleary: https://www.coreycleary.me/where-to-put-your-tests-in-a-node-project-structure

### 4. Тест-хелперы как публичная утилита фреймворка

Паттерн зрелых фреймворков — **фреймворк сам поставляет тест-тулкит**:
- Warden: `import {TestBot, FakeInteraction} from '@warden/core/testing'` — фейковые interaction'ы с отслеживанием состояния и builder'ами для всех типов.
> «The framework ships with a complete testing toolkit ... Use `bot.execute()` to dispatch a fake interaction through the full middleware and handler chain.»
> — https://getwarden.dev/advanced/testing/
- Warden также рекомендует общий файл фабрик:
> «Consider creating a `tests/helpers.ts` file with factory functions for your most common mocks. This keeps your test files focused on the behavior being tested rather than mock setup.»
> — там же

**Практический совет из сообщества:** фабрики моков предпочтительнее инлайн-моков; бизнес-логика — в чистых функциях, Discord-вызовы — в тонкой обёртке.
> «Structure your commands so the business logic lives in pure functions you can test independently, then use thin wrapper functions for Discord API calls.»
> — https://community.latenode.com/t/unit-testing-discord-bot-command-functions-with-jest-mocks/24446

### 5. Тестировать поведение, а не внутрянку

Kent C. Dodds — два типа плохих тестов:
- **False negative:** рефакторинг ломает тест при сохранении поведения (тест знает внутренние имена/состояние).
- **False positive:** поломка кода не ломает тест (тест не покрывает реальное использование).
> «Implementation details are things which users of your code will not typically use, see, or even know about.»
> — https://kentcdodds.com/blog/testing-implementation-details

Метод: **тестируй use-cases, а не код**; смотри, кто «пользователи» API, и пиши тест как инструкцию ручной проверки.
> «Test use cases, not code.»
> — https://kentcdodds.com/blog/how-to-know-what-to-test

**Применительно к `ds`:** тест должен идти через публичный API — `defineHandler`/`defineModule` → `Pipeline.run` → ассерт по **Result**. Не ассертить внутреннее состояние (`cooldowns`, кэш store, приватные поля). Адаптер `bot.ts` тестировать через фейковый interaction → ответ (`interaction.reply` вызван с ожидаемым payload), а не через приватные `toInput`/`reply` — если только их не вынести в экспортируемые чистые функции.

### 6. Возможности `bun:test` для этого проекта

- `mock()`, `spyOn()`, `mock.module()` — стандарт: https://bun.com/docs/test/mocks
- `setSystemTime()`, `useFakeTimers()` + `advanceTimersByTime()` — детерминированные часы (Jest-совместимо): https://bun.com/docs/test/dates-times
- Coverage: `bun test --coverage`.
- Справочник API: https://bun.com/reference/bun/test

## Рекомендации для этого проекта

1. **Создать публичную тест-утилиту `src/core/testing.ts`** и экспортировать из ядра (например `import { createTestContext, runHandler, createFakeInteraction } from '../../core/index.ts'` или отдельный entry `core/testing`). Это устранит дублирование и избавит контрибьютора от знания внутренностей ядра. В состав: `createInput(overrides?)` → `Input`; `createContext(overrides?)` → `{ input, store, memory, logger }` с новым `MemoryStore`, `InMemoryChannelMemory` и тихим логгером; `runHandler(handler, { input?, args? })` → обёртка над `Pipeline.run` (прогоняет парсинг+run = поведение); `createFakeInteraction(overrides?)` → фейковый `ChatInputCommandInteraction` (каст `as unknown as ...`) с `reply/followUp` = `mock()`, `options.get`, `memberPermissions.has()`, `channel.nsfw`, `guild.members.me` (см. фабрики xxczaki/discord-bot и muse).
2. **Переписать генератор `scripts/create-module.ts` и гайд `your-first-module.md`** на эти хелперы: шаблон теста сожмётся до ~10 строк на `runHandler`, дублирующая `ctx()` исчезнет.
3. **Co-locate тесты модулей**: тест модуля класть в `src/modules/<name>/module.test.ts` (тест-гэп виден, импорт `./module.ts`, удаление модуля = удаление теста). Тесты ядра — оставить в `tests/` (текущая конвенция). Проект безопасен для co-location: нет сборки, `tsc --noEmit`, `Registry` игнорирует не-`module.ts` файлы.
4. **Покрыть чистый core поведением, а не юнитами каждого метода**: `parseArgs` (дефолты, required, инвалидные значения), `toDiscordOptions`/`toSlashCommand` (маппинг опций), `Registry` (discover, дубликаты имён), `config` (ошибки), плюс существующие gates-тесты через `Pipeline`. Ассертить **Result**, а не состояние `Pipeline`.
5. **Протестировать discord-адаптер на границе без токена**: вынести чистые функции адаптера (`toInput`, `preconditionEnv`, `grantedCapabilities`, `resultToPayload`) из `bot.ts` в экспортируемый модуль (например `src/core/discord/adapter.ts`) и покрыть их фейк-interaction'ами; один интеграционный тест — прогнать фейковый interaction через `Bot` с `syncSlashCommands: false` и ассертить `interaction.reply` (паттерн «реальный pipeline, а не упрощённый мок» — Warden). Для этого `Bot.onInteraction` стоит сделать публичным/инжектируемым entry point.
6. **Мокать discord.js руками**, без тяжёлых библиотек: фабрики + `mock()` из `bun:test`. `@robojs/mock`/`discord-digital-twin` рассматривать только при появлении настоящих e2e (2026-опция).
7. **Сделать детерминированным тест cooldown** через `setSystemTime()`/`useFakeTimers()` (`pipeline.test.ts:81-92`) вместо реального времени.
8. **Модульные тесты не трогают диск**: в тестах модулей всегда `MemoryStore`; `FileStore` проверен один раз в `store.test.ts` на временной директории (`mkdtempSync`). Это уже так — сохранить.
9. **Не тестировать внутрянку**: избегать ассертов на приватные поля/состояние (`cooldowns`, кэш). Если хочется покрыть edge-case'ы `roll.parseDice` — гнать через `runHandler` с разными `args`, не экспортируя приватную функцию.
10. **Добавить CI-гейт и coverage**: `.github/workflows/test.yml` с `bun install && bun test && bun run typecheck`; при желании `bun test --coverage`. Для контрибьюторской модели это обязательный «забор».

### Краткий план внедрения (порядок работ)

1. `src/core/testing.ts` (+ экспорт) — хелперы `createInput/createContext/runHandler/createFakeInteraction`.
2. Перенести `resultToPayload`/`toInput`/`preconditionEnv`/`grantedCapabilities` в `src/core/discord/adapter.ts` как экспортируемые функции.
3. `tests/`: `args.test.ts`, `registry.test.ts`, `config.test.ts`, `registrar.test.ts`, `adapter.test.ts` (фейк-interaction), `bot.integration.test.ts` (`syncSlashCommands: false`).
4. Обновить генератор, гайд, `module-api.md`; сделать co-location для новых модулей.
5. CI + coverage.
