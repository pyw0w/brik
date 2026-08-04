# Brik

Модульный Discord-бот на TypeScript + discord.js. **Добавил модуль — он работает.**

## Начать

- [Getting Started](guides/getting-started.md) — поднять бота за пару минут
- [Первый модуль](guides/your-first-module.md) — добавить первую команду
- [Dev-режим](guides/dev-mode.md) — hot reload и мгновенная регистрация команд

## Гайды разработчика

- [Архитектура и слои](guides/architecture.md) — contract / internal / host, граница импортов
- [Справочник API](guides/module-api.md) — defineHandler / defineModule / предусловия / store / сервисы / кнопки
- [Тестирование](guides/testing.md) — co-located тесты, `runHandler`, покрытие

## Справочник

- [Модули и команды](reference/modules.md) — что сейчас умеет бот (help, roll, anime, logs…)

## Эксплуатация

- [Развёртывание и настройка](guides/operations.md) — `bot.config.ts`, production, интенты

## О проекте

- `CONTEXT.md` в корне репозитория — единый язык проекта (глоссарий)
- `docs/adr/` — архитектурные решения (почему сделано так)
- `CONTRIBUTING.md` в корне — как вносить вклад

## Для нейросетей и агентов

- [`docs/llm.md`](llm.md) — самодостаточный гайд для AI-агентов (архитектура, глоссарий, границы, воркфлоу)
- `AGENTS.md` и `CLAUDE.md` в корне — краткие обёртки со ссылкой на него