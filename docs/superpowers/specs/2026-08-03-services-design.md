# Сервисы: defineService + ServiceMap

Дата: 2026-08-03
Статус: одобрено (brainstorm)
Связанные ADR: 0007 (слои), будет ADR-0008

## Проблема

У команды модуля может быть внешняя зависимость — например, HTTP-клиент к стороннему API. Сейчас у модуля нет первого-классного способа её объявить: API-клиент пришлось бы создавать в `setup()` или на верхнем уровне модуля, без жизненного цикла (close), без конфигурации с валидацией и без типизированной инъекции в `run(ctx)`.

## Цель

- **Сервис** — именованная, глобальная, жизненно-управляемая зависимость, живущая в `src/services/<name>/service.ts`.
- Модуль **декларирует** нужные сервисы (`services: ['weather'] as const`) и получает **типизированный** `ctx.services`.
- Сервисы имеют `init`/`close` (инициализация до модулей, teardown при shutdown) и опции с zod-схемой из `bot.config.ts`.

## Контракт

### `src/core/service.ts` (экспорт из `src/core/index.ts`)

```ts
export interface ServiceMap {}            // пустой, расширяется сервисами через declare module

export interface ServiceInitContext<O> {
  options: O;                             // из config.services.<name>.options, схема применена
  logger: Logger;
  memory: ChannelMemory;
}

export interface ServiceDef<O = undefined> {
  name: string;
  description?: string;
  optionsSchema?: z.ZodType;              // валидация опций на старте
  init(ctx: ServiceInitContext<O>): unknown | Promise<unknown>;   // → API сервиса
  close?(service: unknown): void | Promise<void>;
}
```

- `defineService(def)` возвращает объект `Service` (name + хуки + опциональная схема).
- `ServiceMap` — расширяемый интерфейс; сервисы аугментируют его в своём `service.ts`.

### Фасад (`src/core/index.ts`) добавляет

`defineService`, `ServiceMap`, `ServiceDef`, `Service`, `ServiceInitContext`, хелпер `ModuleServices<S>` (= `Pick<ServiceMap, S[number]>`).

## Типизация

```ts
// src/services/weather/service.ts
declare module '../../core/index.ts' { interface ServiceMap { weather: WeatherApi } }
```

```ts
// модуль
defineModule({
  name: 'forecast',
  services: ['weather'] as const,          // декларация зависимости
  handlers: [ defineHandler({
    name: 'forecast',
    run: ({ services }) => services.weather.now(),   // WeatherApi
  }) ],
});
```

- `ModuleSetupContext<S>` / `ModuleReadyContext<S>` / `HandlerRunContext<S>` получают `services: Pick<ServiceMap, S[number]>`.
- `S` выводится из `def.services` (`as const` для кортежа-литерала).
- **Fallback типизации**: если инференс в handler-ах капризничает — `ctx.services` типизируется как весь `ServiceMap` (всё равно типизирован; декларация остаётся гейтом сборки/валидации).

## Registry (`src/core/internal/service-registry.ts`)

- `discover(servicesDir)` по конвенции `src/services/<name>/service.ts` (как модули).
- `find(name)`, `getServices()`; защита от дублей имени.
- `scripts/check-boundaries.ts` начинает сканировать `src/services/**`: сервис импортирует только `../../core/index.ts` (код) и `../../core/testing.ts` (тесты).

## Конфиг

`BotConfig` получает опциональный `services?: Record<string, ModuleEntry>`:

```ts
services: { weather: { options: { apiKey: '...' } } },
```

Опции валидируются `optionsSchema` при построении сервиса; ошибка — с именем сервиса и деталями (как у опций модулей).

## Жизненный цикл

`compose.ts` собирает `ServiceRegistry` и передаёт в `Lifecycle`; `interactor` получает `servicesFor(moduleName)`.

`start()`:
1. discover модулей и сервисов
2. resolve включённых модулей
3. вычислить нужные сервисы = объединение `services` включённых модулей
4. для каждого: валидация опций → `init` → карта `name → api`
5. `setup` модулей с `ctx.services`
6. login → sync → `onReady` с `ctx.services`

Ошибки: сервис объявлен модулем, но не найден в `src/services/` → **ошибка старта** с именем; падение `init` → ошибка старта с именем сервиса и ошибкой. Сервис, объявленный в конфиге, но никому не нужный, — не строится (опции его не валидируются).

`shutdown()`: `onShutdown` модулей → `close` сервисов в обратном порядке init.

Строятся только сервисы, нужные включённым модулям (лишние соединения не поднимаются).

## Тесты

- ServiceRegistry: дискавери, дубли имён, find/getServices.
- Lifecycle: init до setup модулей; close в обратном порядке; неизвестный сервис → ошибка старта; валидация опций; сервис не строится, если не нужен.
- `createContext`/`runHandler` в `src/core/testing.ts` принимают `services` (по умолчанию `{}`).
- Типизация проверяется `bun run typecheck` (пример модуля с сервисом).

## Docs и тулинг

- ADR-0008 «Services as lifecycle-managed dependencies».
- Глоссарий `CONTEXT.md`: термин **Service**.
- `docs/guides/module-api.md`, `docs/llm.md`, `AGENTS.md`, `CLAUDE.md`: секции про сервисы.
- Генератор `create:service` (скрипт + package.json script).
- `bot.config.example`/`docs` упоминание секции `services`.

## Пример (демонстрационный)

`src/services/weather/service.ts` — HTTP-клиент погоды, ключ из опций; `src/modules/forecast/module.ts` с `/forecast`, использующим `services.weather`.

## Вне скоупа

- Сеть сервисов (service → service), внедрение сервисов в сервисы.
- Асинхронная загрузка/горячая перезагрузка сервисов.
- Per-handler декларация сервисов (только на уровне модуля).
