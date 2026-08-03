# Shikimori: сервис + модуль «аниме»

Дата: 2026-08-03
Статус: одобрено (brainstorm)
Связанные ADR: 0007 (слои), 0008 (сервисы)

## Проблема

Нет возможности искать и показывать аниме в чате. Данные берём у Shikimori — нужен типизированный клиент к их API с соблюдением жёстких требований (User-Agent, лимиты 5 rps / 90 rpm), и модуль с командами для поиска и просмотра.

## Цель

- **Сервис `shikimori`** в `src/services/shikimori/service.ts` — тонкий типизированный GraphQL-клиент (без новых зависимостей), построенный на `defineService` из фасада.
- **Модуль `anime`** в `src/modules/anime/module.ts` с командами `search`, `top`, `info`.
- Соблюдение API Shikimori: обязательный `User-Agent`, троттлинг под лимиты, только публичный GraphQL-эндпоинт.

## Факты об API Shikimori (GraphQL)

- Endpoint: `POST https://shikimori.io/api/graphql`, body `{ query, variables }`, `Content-Type: application/json`.
- Заголовок `User-Agent` с названием приложения **обязателен** (иначе бан по IP).
- Лимиты: **5 запросов/сек, 90 запросов/мин**.
- Поля-аргументы `animes` (из `app/graphql/queries/animes_query.rb`):
  - `search: String` — текстовый поиск
  - `order: OrderEnum` — default `'ranked'` (топ по рейтингу)
  - `limit: PositiveInt` — default 2, **max 50**, `page: PositiveInt` — default 1
  - `ids: String` — список id через запятую (для info)
- Поля Anime (сумма из `anime_type.rb`, `db_entry_fields.rb`, `ani_manga_fields.rb`, `description_fields.rb`):
  - базовые: `id`, `name`, `russian`, `synonyms`, `japanese`, `english`, `url`, `poster`
  - аниме: `kind`, `status`, `rating`, `origin`, `episodes`, `episodes_aired`, `duration`, `season`, `aired_on`, `released_on`, `studios`, `fansubbers`, `fandubbers`
  - мета: `score`, `genres { name, russian }`, `description`, `description_html`
- Poster: `Types::PosterType` → `original_url`, производные `main_2x_url`, `preview_url`, `mini_url` и т.д.

## Контракт сервиса

### `src/services/shikimori/service.ts`

```ts
export interface AnimeSummary {
  id: number;
  name: string;
  russian: string | null;
  kind: string | null;
  status: string | null;
  score: number | null;
  episodes: number;
  url: string;
  poster: { mainUrl: string; previewUrl: string } | null;
}

export interface AnimeDetails extends AnimeSummary {
  airedOn: string | null;
  genres: { name: string; russian: string | null }[];
  description: string | null;
  studios: { name: string; imageUrl: string | null }[];
  duration: number | null;
}

export interface ShikimoriApi {
  search(query: string, limit?: number): Promise<AnimeSummary[]>;
  top(limit?: number): Promise<AnimeSummary[]>;
  animeById(id: number): Promise<AnimeDetails | null>;
}
```

- `search` → `animes(search: $q, limit: $n, order: ranked)`.
- `top` → `animes(limit: $n, order: ranked)`.
- `animeById` → `animes(ids: $id, limit: 1)`, берём первый элемент; `null`, если пусто.
- GraphQL-запросы — строковые константы; переменные через `variables`.
- Каждое поле маппится в доменные типы (null-tolerant).

### Опции (`bot.config.ts` → `services.shikimori.options`)

```ts
optionsSchema: z.object({
  userAgent: z.string().min(1),        // обязателен: имя приложения для Shikimori
  endpoint: z.string().url().optional().default('https://shikimori.io/api/graphql'),
  minRequestInterval: z.number().min(50).max(5000).optional().default(200), // мс
})
```

- `userAgent` без значения → ошибка старта с именем сервиса (через существующий путь валидации опций).

### HTTP-слой

- `fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, body: JSON.stringify({ query, variables }) })`.
- Не-200 → `ShikimoriError` (класс из сервиса) с русским сообщением: `Shikimori: HTTP <code>`.
- Ответ с непустым `errors` → `ShikimoriError` с первым сообщением ошибки.
- Сеть (fetch бросил) → `ShikimoriError: Не удалось связаться с Shikimori`.
- Имя сервиса не светится в тексте ошибок для пользователя — модуль показывает дружелюбный текст.

### Ошибки и границы

- Модуль импортирует только core-фасад (правило `check:boundaries`), поэтому **не импортирует** класс `ShikimoriError` из сервиса.
- Обработка в модуле — generic `try/catch` вокруг вызова `services.shikimori.*`: любой throw → дружелюбный текст «Не удалось получить данные от Shikimori. Попробуйте позже».
- Проверка имени ошибки не нужна: единственный источник throw внутри вызова — сам сервис.

### Троттлинг

- Соблюдение 5 rps: между запросами выдерживаем `minRequestInterval` (default 200 мс → макс 5 rps).
- Простой гейт: запоминаем timestamp последнего запроса, перед новым ждём `max(0, last + interval - now)`.
- Секвенциально (запросы из одного сервиса), отдельный троттлинг на процесс не нужен.

### Типизация

```ts
declare module '../../core/index.ts' {
  interface ServiceMap { shikimori: ShikimoriApi }
}
```

## Модуль `anime`

`src/modules/anime/module.ts`, `services: ['shikimori'] as const`, три handler-а:

- **`/anime search <query> [limit]`** — поиск по Shikimori.
  - `limit` 1..10, default 5.
  - Ответ: embed со списком «`N.` **русское** (оригинальное) — score, год», если русского нет — только оригинальное.
  - Пустой результат → «Ничего не найдено по запросу …».
- **`/anime top [limit]`** — топ по рейтингу, `limit` 1..10, default 5. Тот же формат списка.
- **`/anime info <id|название>`** — карточка аниме.
  - Ввод-число → `animeById(id)`.
  - Текст → `search(название, 1)`, берём первый результат (в ответе пишем, какое именно нашлось).
  - Карточка: embed с title «русское (оригинальное)», постер в thumbnail, поля: kind, status, score, episodes, год (airedOn), жанры (первые ~5), описание (обрезанное до ~200 символов), ссылка url.
  - kind/status показываются русскими подписями (tv→«ТВ сериал», ongoing→«вышел», и т.п.; маппинг — константа в модуле).
  - Не найдено → «Аниме не найдено».

Все команды оборачивают вызов сервиса в try/catch → дружелюбный текст: «Не удалось получить данные от Shikimori. Попробуйте позже».

## Реализация (порядок)

1. `src/services/shikimori/service.ts` + `service.test.ts`.
2. `src/modules/anime/module.ts` + `module.test.ts`.
3. `bot.config.ts` — включить `services.shikimori` (userAgent) и `modules.anime`.
4. Доки: `docs/guides/module-api.md`, глоссарий, пример.

## Тесты

- Сервис: мок `global.fetch` (в `beforeEach`/`afterEach`).
  - `search`/`top`/`animeById`: корректный URL/метод/headers (включая `User-Agent`), body-запрос, маппинг полей, `animeById` с `ids` и первым элементом, пустой → null.
  - Ошибки: не-200, `errors[]` в теле, fetch-reject → `ShikimoriError` с нужным сообщением.
  - Троттлинг: два подряд запроса не быстрее `minRequestInterval` (фейковые таймеры или проверка времени между fetch-вызовами).
- Модуль: `runHandler` — search пустой/непустой, top, info по id/названию/не найдено, ошибка сервиса → дружелюбный текст.
- `bun run typecheck` — типизация `ctx.services.shikimori`.

## Вне скоупа

- Авторизация OAuth2 на Shikimori (персональный список, `mylist`).
- Рейты юзера, `user_rate`, списки.
- Pagination в поиске (только первая страница).
- Поиск манги/ранобэ.
- Кэш ответов.
