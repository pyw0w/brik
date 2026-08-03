# Дизайн: авто-ревью pull request через opencode CLI

## Цель

Сделать opencode единственным автоматическим ревьюером pull request в личном репозитории `pyw0w/brik`. Opencode анализирует каждый PR из веток репозитория, проверяет его по стандартам проекта и выносит вердикт: `APPROVE` или `REQUEST_CHANGES`. Это заменяет текущий безусловный авто-аппрув бота `OCode-Bot`.

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
opencode run -m opencode/deepseek-v4-flash-free "<промпт>"
```

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

## Что не меняется

- `test.yml` — обязательный чек (bun test, typecheck, check:boundaries, docs:build).
- Защита main: `enforce_admins: true`, `required_approving_review_count: 1`, strict status check `test`, `required_conversation_resolution`.

## Тестирование

- Тестовый PR из ветки репозитория с корректным изменением → ожидается `APPROVED` от `OCode-Bot` после прохождения `test`.
- Тестовый PR с нарушением (например, неверный импорт из модуля) → ожидается `REQUEST_CHANGES` с замечаниями.
- Проверка: `mergeStateStatus` должен быть `CLEAN` после `APPROVED` + зелёного `test`.
- Удаление auto-approve.yml проверяется тем, что PR не получает аппрув мгновенно, а только после ревью opencode.

## Открытые вопросы / решения

- Модель `opencode/deepseek-v4-flash-free` бесплатна временно; при отключении заменить на `opencode/deepseek-v4-flash` (платно) или другую в одном месте workflow.
- Промпт размещается прямо в workflow (переменная/heredoc) для простоты; при разрастании вынести в `.github/prompts/review.md`.
