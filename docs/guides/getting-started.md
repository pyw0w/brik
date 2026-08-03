# Getting Started

Как поднять бота локально за пару минут.

## 1. Предварительно

- [bun](https://bun.sh) (>= 1.1)
- Discord-приложение и токен: [discord.com/developers/applications](https://discord.com/developers/applications) → New Application → Bot → создайте токен.

## 2. Установка и настройка

```bash
bun install
cp .env.example .env
```

В `.env`:

```
DISCORD_TOKEN=ваш_токен
DISCORD_DEV_GUILD_ID=id_вашей_тест_гильды
```

`DISCORD_DEV_GUILD_ID` нужен для dev-режима: команды регистрируются на эту гильду **мгновенно**. Без неё команды регистрируются глобально и Discord кэширует их до минуты (см. [dev-mode](dev-mode.md)).

## 3. Запуск

```bash
bun run dev
```

- `bun --watch` перезапускает процесс при изменении файлов (hot reload).
- Команды регистрируются на dev-гильде.
- В консоли увидите: `Подключено как <бот>` и `Зарегистрировано N команд...`.

Проверьте `/ping` на своей гильде.

## 4. Проверка

```bash
bun test      # юнит-тесты
bun run typecheck
```

## Production

```bash
DISCORD_TOKEN=... bun run start
```

Через process manager (pm2/systemd). Команды регистрируются глобально. Опции — в `bot.config.ts` (см. ниже).

## Конфигурация (`bot.config.ts`)

```ts
import type { BotConfig } from './src/core/internal/config.ts';

export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
    // economy: { enabled: true, options: { startingBalance: 100 } },
  },
  owners: ['id_владельца'],          // для предусловия ownerOnly
  devGuildId: 'id_гильды',            // или через DISCORD_DEV_GUILD_ID
} satisfies BotConfig;
```

- Модуль **включён по умолчанию**; `enabled: false` выключает его.
- `options` валидируются схемой модуля на старте (ошибка — с понятным сообщением).
- Тип `BotConfig` — из `src/core/internal/config.ts`: конфиг пишет оператор бота, а не контрибьютор модулей, поэтому он работает с внутренним типом, а не с публичным контрактом.
