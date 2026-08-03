# Справочник модульного API

Публичный API, на котором живут модули. Импорт — из `'../../core/index.ts'` (относительный путь от `src/modules/<name>/module.ts`). Это **единственная** разрешённая точка входа: `Bot`, `Registry`, `Pipeline`, `FileStore`, `createLogger` и весь discord-адаптер модулям недоступны (проверяется `bun run check:boundaries`).

## `defineModule`

Единица расширения: самодостаточный пакет Handler-ов.

```ts
defineModule({
  name: 'economy',                  // уникальное имя модуля (ключ в bot.config.ts)
  description?: 'Кратко о модуле',
  optionsSchema?: z.ZodType,        // валидация опций из bot.config.ts
  handlers?: Handler[],             // список команд
  setup?(ctx),                      // при загрузке модуля
  onReady?(ctx),                    // после подключения к Discord
  onShutdown?(),                    // при остановке бота
})
```

`setup`/`onReady` получают `{ store, memory, logger, commands }` (+ `client` в `onReady` — сырой discord.js для продвинутых сценариев).

**Публичный API модуля**: экспортируйте функции — другие модули будут их вызывать (Handler-ы Handler-ы не вызывают, см. ADR-0003).

## `CommandCatalog` — список команд

`ctx.commands` — читаемый каталог команд, собранный ядром из включённых модулей. `/help` построен именно на нём.

```ts
setup: ({ commands }) => {
  const all = commands.list();       // [{ name, description }, ...]
}
```

Не путать с Registry: это не реестр модулей, а безопасное «что сейчас отвечает бот». Модулю не нужно трогать Discord, чтобы узнать свои команды.

## `defineHandler`

Атомарное поведение — slash-команда.

```ts
defineHandler({
  name: 'roll',                     // имя команды: /roll
  description: '...',               // ОБЯЗАТЕЛЬНО: идёт в /help и в автоподстановку
  args?: { key: argSpec },          // схема аргументов
  preconditions?: Precondition[],   // гейты до запуска
  capabilities?: Capability[],      // права Bot-а в канале
  run(ctx): Result | Promise<Result>,
})
```

`run` получает:

| Поле | Что это |
|---|---|
| `input` | нормализованный вызов: `commandName`, `args`, `author`, `channel` |
| `args` | распарсенные и типизированные аргументы |
| `store` | персистентный KV модуля (`get`/`set`/`delete`/`has`) |
| `memory` | диалоговая память по каналу (`get`/`set`/`delete` по `channelId`) |
| `logger` | `debug`/`info`/`warn`/`error` |

## `arg` — схема аргументов

```ts
arg.string('Описание')            // → string
arg.string('...').default('2d6')  // опционален, значение по умолчанию
arg.number('...')                 // → number
arg.integer('...')                // → целое число
arg.boolean('...')                // → boolean
arg.enum('...', ['heads','tails'])// → строковое перечисление
```

`description` для аргумента обязателен — Discord требует его для опций команды.

## `Precondition` — предусловия

Проверяются ядром **до** запуска `run`.

```ts
{ type: 'guildOnly' }                                   // только на сервере
{ type: 'dmOnly' }                                      // только в личке
{ type: 'nsfwOnly' }                                    // только в NSFW-канале
{ type: 'ownerOnly' }                                   // только владельцы (config.owners)
{ type: 'permissions', permissions: ['Administrator'] } // права участника
{ type: 'cooldown', seconds: 10 }                       // кулдаун на пользователя
{ type: 'custom', check: (ctx) => ({ ok: true }) }      // кастомная проверка
```

Кастомная: `check(ctx)` возвращает `{ ok: boolean; reason?: string }`.

## `Capability` — права Bot-а в канале

Проверяются ядром перед выполнением; при отсутствии бот отвечает понятной ошибкой.

```ts
capabilities: ['EmbedLinks', 'AttachFiles', 'AddReactions', 'ManageMessages', ...]
```

Доступные: `SendMessages`, `EmbedLinks`, `AttachFiles`, `AddReactions`, `ManageMessages`, `ManageWebhooks`, `UseExternalEmojis`, `UseExternalStickers`.

## `Result` — ответ Handler-а

```ts
{ kind: 'message', content: 'текст', ephemeral?: boolean }
{ kind: 'embed', embed: EmbedData, ephemeral?: boolean }
{ kind: 'attachment', file: { name: 'f.png', data: Uint8Array }, caption?: string, ephemeral?: boolean }
{ kind: 'multiple', results: Result[] }
```

`embed` — стандартная `EmbedData` discord.js (title, description, color, fields, image, footer...).

## Store

```ts
await store.get<T>('key')       // T | undefined
await store.set('key', value)   // персистентно (JSON-файл в .data/<module>.json)
await store.delete('key')
await store.has('key')
```

Данные модуля не пересекаются с данными других модулей (неймспейс по имени).

## Сервисы

**Сервис** — именованная глобальная зависимость модулей (API-клиент, соединение и т.п.). Внешние API/БД — ответственность сервиса, а не модуля (перенос ADR-0002 на уровень зависимостей). Живёт в `src/services/<name>/service.ts` и объявляется через `defineService`:

```ts
// src/services/weather/service.ts
import { z } from 'zod';
import { defineService } from '../../core/index.ts';

export interface WeatherApi {
  now(city: string): Promise<string>;
}

declare module '../../core/index.ts' {
  interface ServiceMap {
    weather: WeatherApi;          // аугментация типов → типизированный ctx.services.weather
  }
}

export default defineService<{ apiKey?: string }>({
  name: 'weather',
  description: 'Демо-сервис погоды (эмуляция внешнего API)',
  optionsSchema: z.object({ apiKey: z.string().optional() }),
  init: ({ options, logger }) => ({ ... }),   // вернуть сам сервис; ядро вызовет до setup модулей
  close: async (service) => { ... },          // опционально: закрыть соединение на shutdown
});
```

Модуль декларирует нужные сервисы через `services: ['name']` и получает их типизированно в `ctx.services.<name>`:

```ts
// src/modules/forecast/module.ts
export default defineModule({
  name: 'forecast',
  services: ['weather'],                        // ядро построит только их
  handlers: [
    defineHandler({
      name: 'forecast',
      description: 'Погода в городе',
      args: { city: arg.string('Город').default('Москва') },
      run: async ({ services, args }) =>
        ({ kind: 'message', content: await services.weather.now(args.city) }),
    }),
  ],
});
```

Опции сервиса — из `bot.config.ts` секции `services` (валидируются `optionsSchema`):

```ts
// bot.config.ts
services: { weather: { enabled: true, options: { apiKey: process.env.WEATHER_API_KEY } } },
```

Жизненный цикл: `init` сервисов — **до** `setup` модулей, `close` — на shutdown в обратном порядке. Ядро строит только сервисы, задекларированные включёнными модулями.

Ещё один рабочий пример — `src/services/shikimori`: реальный GraphQL-клиент с обязательным `User-Agent` (опция `userAgent`) и троттлингом запросов (`minRequestInterval`). См. `src/modules/anime`, который его использует.

## Порядок гейтов

1. **Предусловия** — не прошло → короткая ошибка.
2. **Capabilities** — нет права в канале → понятная ошибка.
3. **`run`** → **Result** → доставка в канал.

(решение — ADR-0001, ADR-0002).

## Тестирование модуля

Тест лежит рядом: `src/modules/<name>/module.test.ts`. Ядро поставляет публичные хелперы из `'../../core/testing.ts'`:

```ts
import { runHandler } from '../../core/testing.ts';

const result = await runHandler(handler, { args: { text: 'привет' } });
```

- `createInput(overrides?)` — нормализованный `Input`;
- `createContext(overrides?)` — `{ input, store, memory, logger }` (всё in-memory, ничего не пишет на диск);
- `runHandler(handler, { input?, args? })` — прогон через реальный `Pipeline` (парсинг + дефолты + run);
- `createFakeInteraction(overrides?)` — фейковое `ChatInputCommandInteraction` (для тестов адаптера, с кастом `as unknown as ...`).

## Что модулям недоступно

| Символ | Почему |
|---|---|
| `Bot`, `Registry`, `Pipeline`, `FileStore`, `createLogger`, `loadConfig` | внутренняя реализация — меняется без гарантий |
| `src/core/internal/**`, `src/core/discord/**` | глубокие импорты в ядро — нарушают границу (ADR-0003) |
| `discord.js` напрямую | контракт лишён деталей Discord; единственный путь — Result/Input |
