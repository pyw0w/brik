# 02. Модульная/плагинная архитектура Discord-бота: паттерны 2026

Дата: 2026-08-03
Статус: исследование (не ADR). Вопрос: как крупные discord.js-боты организуют команды и модули, какие паттерны плагинных систем Node применимы, как сделать авто-дискавери предсказуемым, где граница «ядро / discord-адаптер» и как не вырастить god-object `bot.ts`.

Смежный материал: [01-layer-separation.md](01-layer-separation.md) (разделение слоёв, god-object, фасад) и [03-bun-conventions.md](03-bun-conventions.md). Этот документ — про *модульную систему* как таковую: Registry, жизненный цикл, регистрацию команд, лимиты Discord, hot-reload, расширяемость событиями.

---

## Текущие проблемы

Диагностика по коду `src/core/*` и `src/modules/*` (наложение с 01: god-object `bot.ts`, discord.js в `types.ts`/`module.ts`/`args.ts` — здесь не повторяем, см. 01).

1. **Registry знает только «плоскую» конвенцию и почти не валидирует контракт.** `discover()` (`src/core/registry.ts:37-56`) берёт подкаталоги первого уровня `src/modules/*`, ищет `module.ts` и проверяет лишь `typeof mod.name === 'string'`. Дубликаты имён модулей/команд — есть (fail-fast, это хорошо). Но: нет валидации обязательных полей Handler-а (`description` для Handler-а обязателен — идёт в /help и в автоподстановку, `src/core/handler.ts:13-14`), нет проверки имён на допустимость в Discord (lowercase-регекс, 1-32 символа), нет учёта лимитов. Понятность ошибок для контрибьютора — частичная.

2. **`bot.ts` регистрирует slash-команды из runtime-процесса при каждом старте.** `start()` логинится в gateway и затем `syncCommands()` делает `guild.commands.set()`/`app.commands.set()` (`src/core/discord/registrar.ts:60-77`). Официальный гайд явно рекомендует обратное: отдельный deploy-скрипт на лёгком `REST`-менеджере, не на каждый `ready`, из-за дневного лимита созданий команд (200/день/гильда) и скорости старта. Есть и лимит 100 глобальных `CHAT_INPUT`-команд — не проверяется.

3. **Нет точек расширения, кроме slash-команд.** Маршрутизация обрабатывает только `isChatInputCommand()` (`bot.ts:145`). Кнопки, модалки, контекстные меню, события (`messageCreate`, `guildMemberAdd`) — не покрыты. Единственный escape-hatch: сырой `client` в `onReady` (модуль `help` так и делает). Это ломает абстракции Input/Result/Capability.

4. **Модуль `help` берёт данные из Discord API вместо Registry.** `src/modules/help/module.ts:4-24`: module-level `let clientRef`, `onReady` ловит клиент, `run` делает `client.application.commands.fetch()` — сетевой вызов в Handler-е, глобальное мутируемое состояние, зависимость от готовности клиента. Источник истины о командах уже есть — это `Registry` (и реестр `Bot`).

5. **Жизненный цикл без изоляции ошибок и без документированного порядка.** `runSetup` (`bot.ts:122-129`) не оборачивает `setup` в try/catch — падение одного модуля валит весь `start()`. `onReady`/`onShutdown` уже изолированы (`bot.ts:138, 247-250`). Порядок setup — порядок обнаружения (алфавитный по имени каталога); межмодульных зависимостей при этом нет (ADR-0003: только публичные функции), но это не зафиксировано в документации как контракт.

6. **Двойной маппинг args→Discord.** `toDiscordOptions` (`src/core/args.ts:53-72`) и `toSlashCommand` (`src/core/discord/registrar.ts:14-51`) делают почти одно и то же двумя способами; `toSlashCommand` игнорирует часть веток (`default: void common`). Единственный источник правды для discord-представления аргументов отсутствует.

7. **`tsx watch` = перезапуск процесса.** Это нормальный hot-reload для модулей, но `Registry`/`loadConfig` уже используют `?v=${version}`/`?v=${Date.now()}` cache-busting (`registry.ts:48`, `config.ts:22`) — готовность к in-process re-discover не задокументирована как стратегия.

---

## Паттерны модульных ботов (с источниками)

### 1. discord.js-экосистема: команды как файлы, handler как динамический загрузчик

Канон официального гайда (v14, актуален и в 2026):

- **Команда = файл с двумя экспортами** `data` (SlashCommandBuilder) + `execute`, лежит в подкаталоге-категории `commands/utility/ping.js`. Динамический `fs.readdirSync`-загрузчик кладёт их в `client.commands = new Collection()`, проверяя `'data' in command && 'execute' in command` (guard против недописанных файлов). Раздача — один `interactionCreate`-слушатель: `interaction.isChatInputCommand()`, `commands.get(commandName)`, try/catch с `replied || deferred` → `followUp` или `reply`, `MessageFlags.Ephemeral`.
- **Событие = файл** с `name` (имя события), `once`, `execute(...args)`; загружается тем же динамическим способом.
- **Регистрация — отдельный скрипт** (`deploy-commands.js`) на `REST` + `Routes.applicationGuildCommands`/`Routes.applicationCommands`, без подключения gateway. Причина: «есть дневной лимит на создание команд, не нужно и не желательно подключать клиент и делать это на каждый ready».
- Гайд прямо называет анти-паттерн: «single file with a giant `if`/`else if` chain» — то, от чего нужно уйти.

Источники: https://discordjs.guide/legacy/app-creation/handling-commands , https://discordjs.guide/legacy/app-creation/deploying-commands , https://discordjs.guide/legacy/app-creation/handling-events

Реальные боты подтверждают и развивают этот канон:

- **discord/airhornbot** (официальный референс-бот Discord): `bot/src/discord/{commands,listeners,buttons,types}` — команды как классы (`DiscordChatInputCommand`), регистрация явными функциями `registerGlobalChatInputCommand(new X())`, один `interactionCreate`-слушатель мапит имя → команда и держит fallback (`DynamicSoundCommand`), кнопки версионируются через `customId` (`buttonConfiguration.version`). `bot.ts` тонкий: создаёт клиент, подписывает слушателей, логинится. Источник: https://github.com/discord/airhornbot/blob/main/bot/src/bot.ts , https://github.com/discord/airhornbot/blob/main/bot/src/discord/listeners/InteractionCreateListener.ts
- **openai/dallify-discord-bot**: регистрация команд в `ready`-слушателе (`client.application.commands.set(Commands)`). Источник: https://github.com/openai/dallify-discord-bot/blob/main/src/listeners/ready.ts
- **MenheraBot** (крупный бот, монорепо `packages/events|structures`): расширенный класс клиента (`MenheraClient`), `client.commands = new Collection()`; структурирование по пакетам. Источник: https://github.com/MenheraBot/MenheraBot/blob/master/packages/events/src/structures/menheraClient.ts

Вывод для ds: ds уже ушёл дальше канона (Handler/Input/Result абстрагируют discord.js, модуль ≠ одиночный файл команды) — это правильно. Но канон важен для двух вещей, которых ds не хватает: **отдельный deploy-скрипт** и **файл-на-событие как способ расширения**.

### 2. Плагинные системы Node: что применимо к боту

**Fastify (плагины + encapsulation).** `register(plugin, opts)` создаёт дочерний scope: декорторы/хуки/плагины видны потомкам, но не сиблингам и предкам (DAG). Общее (db, logger) — в корневом scope или через `fastify-plugin` с декларацией зависимостей и диапазона версий. Опции плагина — неймспейсированы (`{ foo: {...} }`). Аналогия прямая: модуль получает ровно объявленное (store/memory/logger), а не общий `Client`; опции модуля уже неймспейсированы через `optionsSchema` + `bot.config.ts`. `await register()`/`after()`/`ready()` дают упорядоченную инициализацию — аналог фазы `setup`→`onReady`. Источники: https://fastify.dev/docs/latest/Reference/Plugins/ , https://fastify.dev/docs/latest/Reference/Encapsulation/ , https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/

**Oclif (команды как файлы, три стратегии дискавери).** `pattern` — glob-поиск файлов в `commands/` (дефолт; тесты/хелперы исключаются glob'ом); `explicit` — один файл, экспортирующий мапу имя→класс команды (для бандлинга и предсказуемости); `single`. Плагины = набор команд + хуков (`init`, `command_not_found`...). Есть manifest (`oclif.manifest.json`) — кэш найденных команд для скорости. Для ds: стратегия ds — «папка = модуль с `module.ts`», она ближе к `pattern`, но guard-валидация контракта у oclif строже, а manifest показывает, что **кэш результатов дискавери — зрелый паттерн**. Источники: https://oclif.io/docs/plugins , https://oclif.io/docs/command_discovery_strategies

**Файловые конвенции (routes-as-files).** Next.js `app/**/route.ts` экспортирует `GET/POST/...`; SvelteKit `+server.ts`. Имя файла = маршрут, ноль регистрации — система сама обходит каталог. Аналогия: `src/modules/<name>/module.ts` — уже ровно это. Ценность конвенции не в механике, а в **предсказуемости**: «положил файл по конвенции — он подхватился; нарушил — получил понятную ошибку». Источник: https://nextjs.org/docs/app/api-reference/file-conventions/route

**Terraform providers (схема как контракт).** Provider декларирует ресурсы/data-sources в виде схемы (`providers.Schema{ResourcesMap: ...}`); рантайм фреймворка управляет их жизненным циклом. Аналогия: `defineModule({ optionsSchema })` уже декларирует схему опций, которую ядро валидирует на старте (`bot.ts:112-120`) — это terraform-подход в миниатюре; недостроено: схема только у опций, но не у «что модуль публикует вовне» и не у допустимости имён. Источник (фреймворк, обзор): https://developer.hashicorp.com/terraform/plugin/framework

**Обобщённый 2026-паттерн плагинной системы** (OneUptime, янв 2026; n-school): компоненты — Plugin Interface (метаданные `name/version/dependencies` + `initialize(context)`/`destroy()`), HookRegistry (`register/unregister/trigger/broadcast` с приоритетами), Plugin Manager (discover → load → validate deps → **топологический порядок инициализации** → `plugins:ready`; enable/disable в рантайме; shutdown в обратном порядке), MessageBus для межплагинной связи, configSchema-валидация. Ключевые правила: «плагин падает в `initialize` → отключается, но приложение продолжает», «хуки вместо прямого изменения ядра», «reverse-order shutdown». Источники: https://oneuptime.com/blog/post/2026-01-26-nodejs-plugin-architecture/view , https://www.n-school.com/plugin-based-architecture-in-node-js/

### 3. Авто-дискавери (Registry): предсказуемость = конвенция + валидация + документирование

Синтез из источников выше:

- **Конвенция должна быть однозначной и проверяемой в момент загрузки.** «Подкаталог с `module.ts` = модуль» — хорошая конвенция (аналог routes-as-files). Недостающее: загрузка должна **fail-fast с понятной ошибкой** при нарушении контракта (нет `name`, нет `description` у Handler-а, дубликат имени, имя не проходит Discord-регекс). Гайд: guard `'data' in command && 'execute' in command` + warning. Oclif: строгие стратегии + manifest.
- **Registry — единственный источник истины** о том, что доступно. Всё, что рендерит /help, тулзы, лимиты — читает Registry, а не Discord API (см. проблему help-модуля).
- **Изоляция ошибок при загрузке:** неудачный модуль не должен валить бота (OneUptime: `plugin.enabled = false`, продолжать).
- **Явный порядок жизненного цикла.** setup → onReady → (рантайм) → onShutdown; при будущих зависимостях между модулями — топологическая сортировка по `dependencies` в метаданных модуля (OneUptime, oclif-плагины) с детекцией циклов. Пока зависимостей нет — зафиксировать, что порядок = порядок обнаружения.
- **Кэш дискавери (manifest)** — зрелая оптимизация (oclif.manifest.json), когда модулей станет много.

### 4. Граница «чистое ядро / discord-адаптер»

Что должно жить в discord-слое (адаптеры), а что в чистом core — сводно из 01 и из реальных ботов:

- **Discord-слой (`core/discord/`):** владение `Client`, intents, `login`; слушатель `interactionCreate` и маршрутизация; трансляция Interaction → `Input` (`toInput`, `preconditionEnv`, `grantedCapabilities` — всё про discord-объекты); доставка `Result` → payload (`resultToPayload`, `toApiEmbed`, `reply`); регистрация команд (`toSlashCommand`, `syncCommands`, маппинг arg-схемы в `SlashCommandBuilder`). airhornbot: `discord/{commands,listeners,buttons}` живут под `discord/`, `bot.ts` не содержит бизнес-логики.
- **Чистое ядро:** `Input`, `Result` (plain-сериализуемый), `Store`/`ChannelMemory`/`Logger` (порты), `Pipeline` (preconditions → capability-гейт → run), `Registry`, жизненный цикл модулей, `defineModule`/`defineHandler`/`arg`, `optionsSchema`-валидация. Ноль импортов discord.js.
- Критерий теста: «логику команды и гейты можно прогнать без сети и без discord.js» (у ds уже так для Handler-ов; для гейтов — после втягивания capability-гейта в `Pipeline`, см. 01).

### 5. God-object `bot.ts`: что именно идёт не так и как избежать

- **Симптом (guide):** гигантская `if/else`-цепочка команд / один файл, делающий всё. У ds вместо цепочки — класс на 299 строк с 6+ ответственностями (детально разобрано в 01).
- **Корень:** composition root (wiring) смешан с поведением (Fowler: DI — «где конструирование, а где поведение»). Решение: тонкий composition root (`start.ts`), который собирает коллабораторов — `engine` (чистая оркестрация), `gateway` (inbound), `deliver` (outbound), `registrar`, `registry`, store-factory — и делегирует им.
- **Фазовая декомпозиция (Sapphire):** даже в discord-фреймворке жизненный цикл разбит на фазы хуков (`PreGenericsInitialization → ... → PostLogin`), а не лежит простынёй. У ds фазы уже есть (`setup`/`onReady`/`onShutdown`) — их надо лишь не держать в god-object.
- **Изоляция ошибок:** каждый коллаборатор/модуль должен падать независимо, с логированием контекста (airhornbot: try/catch вокруг `handle` с именем команды; arnauld-alex: «single points of failure minimized through error isolation»). Источники: https://arnauld-alex.com/building-a-production-ready-discord-bot-architecture-beyond-discordjs , https://github.com/sapphiredev/framework (SapphireClient), https://martinfowler.com/articles/dependency-composition.html

---

## Рекомендации для этого проекта

Приоритезировано; первые два — дешёвые и немедленные, последние — стратегические. Не конфликтуют с планом из 01 (там — слои; здесь — модульная система); выполнять можно параллельно.

1. **`/help` читает Registry, а не Discord API.** Заменить в `src/modules/help/module.ts` `client.application.commands.fetch()` на публичный порт ядра (например `registry.listCommands(): { name, description }[]` — данные уже есть в `Registry.findHandler`/`getModules`). Удалить module-level `clientRef` и `onReady` у help. Обоснование: убирает сетевой вызов из Handler-а, глобальное состояние и обход абстракций (проблема 4); делает /help мгновенным и независимым от готовности клиента; ADR-0003 (модули — только публичный API ядра).

2. **Регистрацию команд вынести в отдельный скрипт (`scripts/deploy-commands.ts`) на `REST`, в runtime оставить только dev-guild sync.** `start()` не должен на каждый старт дёргать `app.commands.set`. В prod: deploy один раз через скрипт (полный `set` = идемпотентный diff). В dev: гильдовая регистрация мгновенна (ADR-0005 уже заложил `devGuildId`). Обоснование: официальная рекомендация гайда (проблема 2), дневной лимит 200 созданий/день/гильда, скорость старта, разделение «деплой» и «рантайм».

3. **Гейт Discord-валидации при регистрации (Registry или registrar):** имя команды/опции — `^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$` (lowercase-варианты обязательны), описание Handler-а обязательно (уже в схеме — проверять при `register`), required-опции до optional, ≤100 глобальных `CHAT_INPUT`, суммарно ≤8000 символов на команду, лимит 25 опций. Fail-fast с именем модуля/команды в ошибке. Обоснование: эти ошибки сейчас прилетают из Discord API на позднем этапе (проблема 2/1); источник лимитов — Discord docs: https://discord.com/developers/docs/interactions/application-commands

4. **Задокументировать и ужесточить контракт дискавери.** В `Registry.discover`: после загрузки `module.ts` валидировать конвенцию целиком — `name` (уникальный, валидный), все `handlers` имеют `description`, `optionsSchema` парсится; при нарушении — `Error` с понятным сообщением «модуль X: ...», а не молчаливое пропуск. Зафиксировать в `docs/guides/your-first-module.md` + `CONTRIBUTING.md`: «каждый подкаталог с `module.ts` — модуль; порядок setup = порядок обнаружения; зависимостей между модулями нет (ADR-0003)». Обоснование: предсказуемость дискавери = конвенция + валидация + документация (раздел 3), контрибьютор без знания ядра получает понятную обратную связь.

5. **Изолировать ошибки жизненного цикла модуля.** `runSetup`: обернуть `mod.setup` в try/catch — при падении логировать, отключать модуль и продолжать (`this.enabledModules` минус модуль), а не ронять весь `start()`. Единая политика: setup/onReady/onShutdown — фатально только для модуля, не для бота (как уже сделано для onReady/onShutdown). Обоснование: OneUptime `initialize() → disabled, continue`; аргумент «изоляция точек отказа» (проблема 5).

6. **Ввести точки расширения вне slash-команд — но через абстракции ядра, а не сырой client.** Минимальный шаг: задокументировать в `module-api.md`, что `onReady({ client })` — **escape hatch**, а не паттерн; целевой — core-level HookRegistry (по образцу OneUptime: `register/trigger/broadcast`, приоритеты) поверх дискорд-событий (`messageCreate`, `guildMemberAdd`, button/modal) в gateway-слое. Тогда модуль объявляет «слушаю событие X» и получает нормализованный объект. Обоснование: проблема 3 — сегодня любой не-slash функционал требует onReady + raw client и ломает Capability/Precondition/Result.

7. **Консолидировать маппинг args→Discord в одном адаптере.** `toDiscordOptions` (args.ts) и `toSlashCommand` (registrar.ts) дублируют друг друга; `toSlashCommand` теряет ветки. Оставить одну функцию в `core/discord/` (например `toDiscordOptions` → `SlashCommandBuilder`), `toDiscordOptions` из args.ts удалить из публичного экспорта. Обоснование: единственный источник правды, DRY, меньше расхождений (проблема 6).

8. **Зафиксировать стратегию hot-reload.** Текущий `tsx watch` (перезапуск процесса) — достаточно и предсказуемо для модулей. In-process re-discover (`Registry.discover` уже умеет `?v=` cache-busting) — только если понадобится live-перезагрузка без потери сессии; при её введении — перерегистрация slash-команд только на dev-гильду (ADR-0005). Записать в `docs/guides/dev-mode.md`. Обоснование: проблема 7; не строить in-process reload, пока process-restart закрывает задачу (OneUptime: hot-reloading — advanced, «добавляйте по мере роста»).

9. **При росте модулей — manifest дискавери и топологический порядок.** В метаданные модуля добавить опциональный `dependencies?: string[]`; инициализацию (setup) сортировать топологически с детекцией циклов (есть код-референс в OneUptime PluginManager); опциональный кэш результатов `discover` (аналог `oclif.manifest.json`). Сейчас не нужно (модулей 3) — зафиксировать как documented future. Обоснование: раздел 2/3; дешёво заложить в контракт, дорого встроить потом.

10. **Покрыть модульную систему тестами.** Минимум: `registry.test.ts` (дискавери, дубликаты, нарушение контракта), `registrar.test.ts` (маппинг аргументов, валидация лимитов/имён), `bot-pipeline.test.ts` («предусловия + capability-гейт» как единый шаг, без discord.js — после втягивания гейта в `Pipeline`, см. 01 п.4). `tests/modules/` сейчас пуст. Обоснование: модульная система — это контракт; контракт без тестов регрессирует незаметно (гайд: guard'ы против недописанных команд).

---

## Источники

- discord.js Guide — Command Handling / Registering Commands / Event Handling: https://discordjs.guide/legacy/app-creation/handling-commands , /deploying-commands , /handling-events
- discord/airhornbot: https://github.com/discord/airhornbot
- openai/dallify-discord-bot: https://github.com/openai/dallify-discord-bot
- MenheraBot: https://github.com/MenheraBot/MenheraBot
- Fastify Plugins / Encapsulation: https://fastify.dev/docs/latest/Reference/Plugins/ , /Reference/Encapsulation/ ; Snyk «Fastify plugins as building blocks»: https://snyk.io/blog/fastify-plugins-for-backend-node-js-api/
- Oclif Plugins / Command Discovery Strategies: https://oclif.io/docs/plugins , https://oclif.io/docs/command_discovery_strategies
- Next.js Route Handlers (route.ts): https://nextjs.org/docs/app/api-reference/file-conventions/route
- Terraform Plugin Framework (схема как контракт): https://developer.hashicorp.com/terraform/plugin/framework
- OneUptime «How to Build Plugin Architecture in Node.js» (2026-01): https://oneuptime.com/blog/post/2026-01-26-nodejs-plugin-architecture/view ; n-school «Plugin Based Architecture in Node.js» (2025): https://www.n-school.com/plugin-based-architecture-in-node-js/
- Arnauld Alex «Building a Production-Ready Discord Bot»: https://arnauld-alex.com/building-a-production-ready-discord-bot-architecture-beyond-discordjs
- Discord Docs — Application Commands (лимиты, регекс имён): https://discord.com/developers/docs/interactions/application-commands
- Смежные: research/01-layer-separation.md, research/03-bun-conventions.md; ADR-0001..0006 в docs/adr/
