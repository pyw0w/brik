# Тестирование

Тесты — **co-located**: файл `src/modules/<name>/module.test.ts` лежит рядом с `module.ts`. Отдельной директории `tests/` нет. Это правило — часть культуры проекта (ADR-0006: документация и качество — first-class).

## Быстрый старт

```bash
bun test                # все тесты
bun run test:coverage   # + отчёт о покрытии (порог: 0.7, bunfig.toml)
```

`bunfig.toml` исключает `docs/**`, `scripts/**`, `research/**`, `.data/**` из поиска тестов.

## Как тестировать Handler

Handler — чистая функция, поэтому тестируется без сети и без Discord. Ядро поставляет публичные хелперы из `'../../core/testing.ts'`:

```ts
import { describe, expect, it } from 'bun:test';
import { runHandler } from '../../core/testing.ts';
import module from './module.ts';

const handler = module.handlers.find((h) => h.name === 'roll');

it('бросает кубики по формуле', async () => {
  const result = await runHandler(handler, { args: { dice: '2d6' } });
  // result — Result; проверяем содержимое
});
```

| Хелпер | Что делает |
|---|---|
| `runHandler(handler, { input?, args? })` | прогон через **реальный** `Pipeline` (парсинг + дефолты + run) — основной способ |
| `runComponent(handler, { id, customId? })` | прогон component-хэндлера кнопки, как при живом клике (`customId` строится автоматически) |
| `createInput(overrides?)` | нормализованный `Input` |
| `createContext(overrides?)` | `{ input, store, memory, logger }` — всё in-memory, ничего не пишет на диск |
| `createFakeInteraction(overrides?)` | фейковое `ChatInputCommandInteraction` (для тестов адаптера) |
| `createFakeButtonInteraction(overrides?)` | фейковое нажатие кнопки (для тестов адаптера) |

### Тест с store

`runHandler` прогоняет Handler через реальный Pipeline, поэтому `ctx.store` работает как в проде:

```ts
it('хранит последний бросок', async () => {
  await runHandler(handler, { args: { dice: '3d6' } });
  const result = await runHandler(handler, { args: {} });  // дефолт '2d6' не сработает — ключ уже есть
  // проверяем результат
});
```

Для прямого доступа к store/памяти в тестах используйте `createContext(overrides?)` и передайте свой `MemoryStore`.

### Тест component-хэндлера (кнопки)

```ts
it('перебрасывает кубики по кнопке', async () => {
  await runHandler(handler, { args: { dice: '4d6' } });
  const result = await runComponent(handler, { id: 'reroll' });
  expect(result.kind).toBe('update');
});
```

## Что тестировать

- **Каждый Handler** — как минимум happy path и дефолты аргументов.
- **Ветки ошибок** — невалидная формула, пустой ответ API и т.п.
- **Публичные функции модуля** (если экспортируете API для других модулей).
- **Сервисы** — логику клиента (парсинг ответа, троттлинг); сетевые вызовы — на фейковом `fetch` или через инъекцию.

## Примеры в репозитории

- `src/modules/roll/module.test.ts` — Handler + component-хэндлер (кнопка переброса).
- `src/modules/anime/module.test.ts` — ветки ошибок и границы аргументов.
- `src/services/shikimori/service.test.ts` — сервис с фейковым `fetch`.
- `src/core/*.test.ts` — тесты ядра (используют internal-хелперы, модулям недоступные).

## Покрытие

Порог — **0.7** (`bunfig.toml`). Проверяется в CI вместе с `typecheck` и `check:boundaries`.

## Проверка после изменений

```bash
bun test                 # тесты
bun run typecheck        # типы
bun run check:boundaries # границы импортов
bun run docs:build       # доки (если трогали docs/)
```
