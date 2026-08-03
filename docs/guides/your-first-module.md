# Первый модуль

Главный гайд: вы добавляете боту функционал, **не трогая ядро**. Всё, что вам нужно — файл модуля в `src/modules/`.

## Генератор

```bash
bun run create:module greetings
```

Создаёт:

```
src/modules/greetings/
├── module.ts        # каркас модуля
└── module.test.ts   # юнит-тест (co-located, рядом с кодом)
```

Откройте `src/modules/greetings/module.ts`:

```ts
import { arg, defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: 'greetings',
  description: 'Что делает этот модуль',
  handlers: [
    defineHandler({
      name: 'greetings',
      description: 'Короткое описание команды',
      args: {
        text: arg.string('Что-нибудь'),
      },
      run: async ({ args }) => {
        return { kind: 'message', content: `Вы сказали: ${args.text}` };
      },
    }),
  ],
});
```

## Что здесь происходит

- **`defineModule`** объявляет модуль: имя + список Handler-ов + опциональный жизненный цикл (`setup`, `onReady`, `onShutdown`).
- **`defineHandler`** объявляет команду:
  - `name` — имя slash-команды (`/greetings`);
  - `description` — **обязательно**, попадает в `/help`;
  - `args` — схема аргументов через `arg.*`; значения приходят типизированными в `ctx.args`;
  - `run` — сама логика; получает `{ input, args, store, memory, logger }` и возвращает **Result**.
- **Result** — типизированный ответ: `{ kind: 'message', content }`, `{ kind: 'embed', embed }`, `{ kind: 'attachment', file }` или `{ kind: 'multiple', results }`.

## Запуск и проверка

```bash
bun test                       # тест вашего модуля (создан генератором)
bun run dev                    # hot reload: команда уже на dev-гильде
```

Поправьте файл — `bun --watch` перезапустит бота, и `/greetings` обновится **мгновенно** на dev-гильде.

## Тест модуля

Сгенерированный `module.test.ts` использует хелпер `runHandler` из `'../../core/testing.ts'` — он прогоняет Handler через реальный Pipeline (парсинг аргументов, дефолты), не подключаясь к Discord и не трогая диск:

```ts
import { runHandler } from '../../core/testing.ts';

const result = await runHandler(handler, { args: { text: 'привет' } });
```

## Добавляем права, предусловия, хранение

```ts
import { z } from 'zod';
import { arg, defineHandler, defineModule } from '../../core/index.ts';

export default defineModule({
  name: 'greetings',
  description: 'Приветствия',
  optionsSchema: z.object({
    defaultGreeting: z.string().default('Здравствуйте'),
  }),
  handlers: [
    defineHandler({
      name: 'greet',
      description: 'Поздороваться',
      args: {
        name: arg.string('Имя'),
      },
      preconditions: [
        { type: 'guildOnly' },
        { type: 'cooldown', seconds: 10 },
      ],
      capabilities: ['EmbedLinks'],
      run: async ({ args, store, logger }) => {
        const count = (await store.get<number>('greeted') ?? 0) + 1;
        await store.set('greeted', count);
        logger.info('greet', { name: args.name });
        return {
          kind: 'embed',
          embed: {
            title: 'Привет!',
            description: `${args.name}, вы ${count}-й гость!`,
          },
        };
      },
    }),
  ],
});
```

Полный список предусловий, capabilities и возможностей store — в [справочнике API](module-api.md).

## Публичный API модуля

Хотите, чтобы другой модуль мог вызывать вашу фичу (например, «выдать монеты» из модуля экономики)? Просто экспортируйте функцию из файла модуля:

```ts
export function give(userId: string, amount: number) { ... }
```

Другой модуль импортирует и вызывает как обычный код. Handler-ы при этом **не вызывают Handler-ов** — только публичные функции (решение — [ADR-0003](../adr/0003-module-isolation-by-public-api.md)).
