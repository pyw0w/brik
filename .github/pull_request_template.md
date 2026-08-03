# Pull Request

Выберите подходящий шаблон:

- [**Feature**](?template=feature.md) — новая функциональность (модуль, сервис, команда)
- [**Bugfix**](?template=bugfix.md) — исправление ошибки или регрессии
- [**Docs**](?template=docs.md) — документация, ADR, заметки

Для создания PR с конкретным шаблоном:

- `gh pr create --base main --title "..." --body ""` затем добавьте `?template=feature.md` к ссылке, или используйте:
- `https://github.com/pyw0w/brik/compare/main...<branch>?template=feature.md`

Перед открытием PR убедитесь, что все проверки из AGENTS.md пройдены:

- `bun test`
- `bun run typecheck`
- `bun run check:boundaries`
- `bun run docs:build`
