# Дизайн: opencode как авто-ревьюер PR и триажер issues

## Цель

Сделать opencode единственным автоматическим ревьюером pull request и автономным триажером issues в личном репозитории `pyw0w/brik`.

Для PR: opencode анализирует каждый PR из веток репозитория, проверяет его по стандартам проекта и выносит вердикт `APPROVE` или `REQUEST_CHANGES`. Это заменяет текущий безусловный авто-аппрув бота `OCode-Bot`.

Для issues: opencode автономно обрабатывает новые issues — анализирует, комментирует, вешает лейблы триажа, может закрыть `wontfix` и создать PR-фикс для `agent-ready`.

## Предпосылки и ограничения

- Репозиторий личный (owner type `User`), поэтому bypass-allowances для branch protection недоступны через API (REST 422, GraphQL молча игнорирует).
- Автор не может аппрувить собственный PR (`pyw0w`), поэтому вердикт выносится от имени бота `OCode-Bot` (коллаборатор с правом `write`) через его PAT (`BOT_PAT`). Ревью от бота засчитывается в требуемое «1 approving review».
- Требование «1 approving review» для main сохраняется.
- Применяется только к PR из веток этого репозитория; PR из форков не ревьюятся (безопасность секрета `BOT_PAT`).

## Архитектура

Новый workflow: `.github/workflows/opencode-review.yml`.

Триггер:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
```

Схема джобы `review`:

1. `if: github.event.pull_request.head.repo.full_name == github.repository` — только PR из репозитория.
2. `actions/checkout@v4` с `fetch-depth: 0` — полная история для git-контекста opencode.
3. Установка CLI: `curl -fsSL https://opencode.ai/install | bash`.
4. Запуск ревью через `opencode run` с кастомным промптом.

Окружение для шага ревью:

```yaml
env:
  OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
  GH_TOKEN: ${{ secrets.BOT_PAT }}
  OPENCODE_PERMISSION: '{ "bash": { "*": "deny", "gh*": "allow" } }'
```

Команда:

```bash
opencode run --auto -m opencode/deepseek-v4-flash-free --title "review PR #<n>" "<промпт>"
```

- `--auto` — авто-одобрение разрешённых действий, без интерактивных запросов в CI.
- Промпт передаётся позиционным аргументом (heredoc/переменная), номер PR подставляется из контекста workflow.

Модель — текущая бесплатная `opencode/deepseek-v4-flash-free` (провайдер `opencode`, ключ Zen). Бесплатные модели Zen могут быть отключены в будущем — тогда модель заменить в одном месте.

## Промпт ревью

Промпт задаёт opencode следующие обязанности:

**Что делает:**
- Получает номер PR и читает его через `gh pr view <n>`, `gh pr diff <n>`.
- Читает целиком изменённые файлы, а не только диффы.
- Проверяет по стандартам проекта:
  - код-стиль и типы (TypeScript, bun);
  - границы модулей: `src/modules/**` импортируют только `../../core/index.ts` (код) и `../../core/testing.ts` (тесты); никогда `discord.js`, `src/core/internal/**`, `src/core/discord/**`, `src/app/**`;
  - services через `ctx.services.<name>`, декларация `services: ['name']`;
  - тесты co-located рядом с кодом;
  - у каждого хендлера есть `description`;
  - хендлеры — чистые функции: `run(ctx)` возвращает `Result`, никакого `ctx.client`;
  - согласованность с `docs/llm.md` и архитектурой.
- Проверяет, что diff соответствует целям PR и не содержит явных багов.

**Вердикт:**
- Если всё по стандартам: `gh pr review <n> --approve`.
- Если есть нарушения: `gh pr review <n> --request-changes --body "<нумерованный список замечаний со ссылками на файлы и строки>"`.
- Формат команды всегда строго задан в промпте.
- Мелкие замечания-подсказки можно оставлять inline-комментариями через `gh api`, но основной вердикт — через `gh pr review`.

**Запреты (прописаны в промпте):**
- Не изменять файлы, не коммитить, не пушить.
- Не мержить и не закрывать PR.
- Не выносить вердикт «по ощущениям» — только по конкретным нарушениям кода.
- Если нарушений нет — только `--approve`.

## Права доступа

- `BOT_PAT`: PAT бота `OCode-Bot` (scope `repo`), уже в secrets. Используется как `GH_TOKEN` для `gh pr review`.
- `OPENCODE_API_KEY`: ключ OpenCode Zen (провайдер `opencode`). Добавляется пользователем в secrets репозитория по инструкции (скопировать с https://opencode.ai/auth).
- `OPENCODE_PERMISSION` ограничивает opencode: разрешены только команды `gh*`, всё остальное в bash запрещено.

## Обработка ошибок

- **Fail-closed**: если opencode завершился ошибкой (нет ключа, лимит, сеть), вердикт не ставится, джоба красная. Пользователь видит неудачный чек и ревьюит вручную. Невозможно случайно заапрувить без фактической проверки.
- Секрета `BOT_PAT` касается только `gh`-команда вердикта; при падении до неё — ничего не выполняется.

## Конкуренция

```yaml
concurrency:
  group: pr-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

- На каждый push в PR (`synchronize`) workflow перезапускается.
- `dismiss_stale_reviews: true` уже включён в защите main → старый вердикт бота устаревает автоматически.
- `concurrency` не даёт накапливать параллельные ревью одного PR.

## Удаление авто-аппрува

- Удаляется `.github/workflows/auto-approve.yml`.
- Бот `OCode-Bot` остаётся коллаборатором с `write` — через него работает `BOT_PAT` для вердиктов opencode.
- Секрет `BOT_PAT` остаётся в secrets.

## Триаж issues

Новый workflow: `.github/workflows/opencode-issue-triage.yml`.

Триггер:

```yaml
on:
  issues:
    types: [opened]
```

Схема джобы `triage`:

1. `actions/checkout@v4` с `fetch-depth: 1`, `token: ${{ secrets.BOT_PAT }}` (креды нужны для git-push при создании PR-фиксов).
2. Установка CLI: `curl -fsSL https://opencode.ai/install | bash`.
3. Установка bun (для проверок при PR-фиксах): `oven-sh/setup-bun@v2`.
4. Запуск через `opencode run` с промптом триажа.

Права джобы: `contents: write` (push ветки), `pull-requests: write` (создание PR), `issues: write` (комментарии, лейблы, закрытие).

Окружение:

```yaml
env:
  OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
  GH_TOKEN: ${{ secrets.BOT_PAT }}
  OPENCODE_PERMISSION: '{ "bash": { "*": "deny", "gh*": "allow" } }'
```

### Промпт триажа

Opencode следует конвенциям `docs/agents/issue-tracker.md` и таблице `docs/agents/triage-labels.md`:

- Читает issue целиком (`gh issue view <n> --comments`).
- Комментирует с анализом: что за проблема, достаточно ли данных, куда смотреть в коде.
- Вешает лейбл триажа по конвенции:
  - `info-needed` — не хватает деталей, в комментарии задаёт уточняющие вопросы;
  - `agent-ready` — полная спецификация, данных достаточно;
  - `human-ready` — требует реализации человеком (не автоматизируется);
  - `wontfix` — не будет реализовано (закрывает issue с объяснением).
  - `triage` — если не может решить, оставляет на ручную оценку.
- Для `agent-ready` может создать PR-фикс: создать ветку, реализовать, открыть PR на `main`. PR проходит обычный ревью-процесс (opencode-review).
- Не дублирует: если issue уже обработано (есть лейбл триажа) — не трогает.

### Права доступа

- `BOT_PAT` (OCode-Bot) даёт права на комментирование, лейблы, закрытие issue, создание веток и PR. Открытые issues/PR из репозитория.
- `OPENCODE_API_KEY` — тот же ключ Zen.
- `OPENCODE_PERMISSION` ограничивает до `gh*`.

### Безопасность

- `issues` event не содержит кода из форков; создание PR-фикса идёт внутри репозитория, PR проходит обычный ревью-процесс (opencode-review + test) — защита от неотрецензированного кода сохраняется.

## Что не меняется

- `test.yml` — обязательный чек (bun test, typecheck, check:boundaries, docs:build).
- Защита main: `enforce_admins: true`, `required_approving_review_count: 1`, strict status check `test`, `required_conversation_resolution`.

## Тестирование

### Ревью PR

- Тестовый PR из ветки репозитория с корректным изменением → ожидается `APPROVED` от `OCode-Bot` после прохождения `test`.
- Тестовый PR с нарушением (например, неверный импорт из модуля) → ожидается `REQUEST_CHANGES` с замечаниями.
- Проверка: `mergeStateStatus` должен быть `CLEAN` после `APPROVED` + зелёного `test`.
- Удаление auto-approve.yml проверяется тем, что PR не получает аппрув мгновенно, а только после ревью opencode.

### Триаж issues

- Новое issue без деталей → `info-needed` с уточняющими вопросами.
- Новое issue с полным описанием → `agent-ready` + анализ в комментарии.
- Заведомо нереализуемое issue → `wontfix`, закрыто с объяснением.
- Проверка, что лейблы соответствуют таблице `docs/agents/triage-labels.md`.

## Открытые вопросы / решения

- Модель `opencode/deepseek-v4-flash-free` бесплатна временно; при отключении заменить на `opencode/deepseek-v4-flash` (платно) или другую в одном месте workflow.
- Промпты размещаются прямо в workflow (переменная/heredoc) для простоты; при разрастании вынести в `.github/prompts/`.
