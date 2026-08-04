# Развёртывание и настройка (ops)

Руководство для оператора бота: конфигурация, production-запуск, интенты и привилегированные опции.

## Конфигурация — `bot.config.ts`

Файл решает, какие модули активны и с какими опциями (механизм **Enable**, ADR-0004). Пишет его **оператор**, а не контрибьютор модулей, поэтому используется внутренний тип `BotConfig`:

```ts
import type { BotConfig } from './src/core/internal/config.ts';

export default {
  modules: {
    help: { enabled: true },
    ping: { enabled: true },
    roll: { enabled: true },
    forecast: { enabled: true },
    anime: { enabled: true },
    buttons: { enabled: true },
    logs: { enabled: true },
    // economy: { enabled: true, options: { startingBalance: 100 } },
  },
  services: {
    shikimori: { options: { userAgent: 'Brik (...)' } },
    // weather: { enabled: true, options: { apiKey: process.env.WEATHER_API_KEY } },
  },
  owners: ['owner-user-id'],   // для предусловия ownerOnly
  devGuildId: 'dev-guild-id',  // или через DISCORD_DEV_GUILD_ID
} satisfies BotConfig;
```

- Модуль **включён по умолчанию**; `enabled: false` выключает его.
- `services.<name>.options` валидируются `optionsSchema` сервиса (zod).
- `modules.<name>.options` валидируются `optionsSchema` модуля (zod).
- Неверные опции → понятная ошибка на старте.
- Токен — из `DISCORD_TOKEN` (env), или через поле `token`.

## Запуск

| Режим | Команда | Команды регистрируются |
|---|---|---|
| Dev (hot reload) | `bun run dev` | на dev-гильде, мгновенно |
| Production | `DISCORD_TOKEN=... bun run start` | глобально |

- **Есть `devGuildId` / `DISCORD_DEV_GUILD_ID`** → команды на гильде (мгновенные обновления).
- **Нет** → команды глобально; Discord кэширует их до минуты.

Для production — просто **не задавайте** `devGuildId` / `DISCORD_DEV_GUILD_ID`.

## Регистрация команд без gateway

REST-скрипт `bun run deploy:commands` регистрирует slash-команды, не подключаясь к gateway. Полезно в CI или при накате команд:

```bash
bun run deploy:commands   # на dev-гильде (config.devGuildId) или глобально
```

## Управление процессом

Production-запуск — через process manager (`pm2`, `systemd`). Пример systemd-юнита (принципиально):

```ini
[Unit]
Description=Brik Discord bot
After=network-online.target

[Service]
WorkingDirectory=/srv/brik
ExecStart=/usr/local/bin/bun run src/index.ts
EnvironmentFile=/srv/brik/.env
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

## Хранение данных

- **Store модуля** — персистентный KV, файл в `.data/<module>.json` (неймспейс по модулю). Переживает рестарт — бэкапите и держите на постоянном диске.
- **Диалоговая память** по каналу — in-memory, сбрасывается при рестарте (короткие многошаговые сценарии).

## Интенты и права приложения

Некоторые модули требуют **привилегированных интентов** в настройках приложения на [discord.com/developers](https://discord.com/developers/applications):

| Модуль | Что нужно |
|---|---|
| `logs` (события) | `GuildMembers`, `MessageContent` (для чтения удалённых/отредактированных сообщений) |
| обычные команды | `applications.commands` (scope бота) |

Без нужных интентов gateway-события просто не приходят — модуль работает, но ничего не логирует.

## FAQ / отладка

- **Команды не обновились** — глобальная регистрация кэшируется до минуты; используйте `devGuildId` или `bun run deploy:commands`.
- **Сервис не строится** — проверьте, что модуль декларирует его в `services: ['name']` и опции валидны.
- **Модуль не включается** — опция `enabled: false` в `bot.config.ts`, либо ошибка схемы на старте.
- **Нет данных в store после рестарта** — проверьте путь `.data/` и права на запись.