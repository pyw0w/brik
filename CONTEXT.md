# Brik

Модульный Discord-бот на TypeScript/Node.js (discord.js). Построен так, чтобы сторонние контрибьюторы могли добавлять функционал без понимания ядра: добавил модуль — он работает. Документация для контрибьюторов — обязательная часть проекта.

## Language

**Bot**:
Один Discord-инстанс приложения (один токен, один gateway), который загружает модули.
_Avoid_: сервис, приложение

**Module**:
Единица расширения: самодостаточный пакет связанных Handler-ов, объявленный через `defineModule`; опционально несёт свою инициализацию (`setup`, `onReady`, `onShutdown`), состояние и публичный API (экспортируемые функции) для других модулей. Одиночная команда — это тривиальный модуль с одним Handler.
_Avoid_: плагин, команда, фича

**Handler**:
Атомарное поведение, объявляемое через `defineHandler`: имя команды, схема аргументов, предусловия, Capabilities и описание. Сопоставляется с Input-ом и возвращает Result. Не вызывает другие Handler-ы напрямую — только публичные функции других модулей.
_Avoid_: команда, обработчик команды, action

**Input**:
Нормализованный вызов slash-команды: имя, аргументы (уже распарсенные), автор, канал. Лишено деталей Discord API.
_Avoid_: message, event, invocation

**Result**:
Типизированный ответ Handler-а (текст, embed, attachment...), который ядро доставляет в канал.
_Avoid_: response, reply, output

**Capability**:
Право, которое Handler/модуль требует от Bot-а в канале (embed links, attach files...), проверяемое ядром перед доставкой Result-а; при отсутствии ядро сообщает понятную ошибку.
_Avoid_: platform feature, permission requirement

**Precondition**:
Проверка перед запуском Handler-а (права пользователя, cooldown, NSFW-канал...), объявляемая в схеме Handler-а; встроенный набор + крючок для кастомных.
_Avoid_: guard, middleware, permission check

**Store**:
Персистентное KV-хранилище, предоставляемое ядром, неймспейсированное по модулю; также диалоговая память по каналу для многошаговых сценариев. Остальные данные (внешние БД, API) модуль держит сам.
_Avoid_: database, memory, cache

**Registry**:
Реестр обнаруженных модулей и Handler-ов (авто-дискавери по конвенции); источник истины о том, что доступно для включения.
_Avoid_: index, collection

**Enable**:
Решение конфигурации (`bot.config.ts`) о том, какие модули активны и с какими опциями (валидируются схемой модуля).
_Avoid_: register, activate, load

**Core**:
Публичный контракт фреймворка, который импортируют модули: `src/core/index.ts` — курируемый фасад + типы/фабрики (`defineModule`, `defineHandler`, `arg`, `Result`, `Input`, `CommandCatalog`). Стабилен, документирован (ADR-0006). Единственная разрешённая точка входа для модулей.
_Avoid_: framework, runtime, kernel

**Internal**:
Реализация контракта: `src/core/internal/` (Registry, Pipeline, store/logger/config). Не стабилен и модулям недоступен — импортируется только host-ом и тестами ядра. В фасад не попадает.
_Avoid_: implementation, core internals, private API

**Host**:
Сборка приложения: `src/app/` (compose, lifecycle, interactor) + discord-адаптер (`src/core/discord/`). Единственное место, где живёт runtime-discord.js (gateway, registrar, adapter). Модули сюда не импортируют.
_Avoid_: wiring, app layer, infrastructure, composition
