# invest-analytic

Агент-аналитик портфеля Tinkoff Invest: **NestJS 12 + LangGraph 1.x + MCP**.

Агент отвечает на вопрос «что у меня в портфеле» строго по данным брокера, запрашивает подтверждение перед каждым чтением и пишет трейсы в LangSmith. Провайдер LLM и MCP-серверы подключаются только конфигурацией.

> Проект в стадии MVP: реализован каркас и конфигурация, остальные группы задач — в `openspec/changes/portfolio-analyst-agent-mvp/tasks.md`.

## Требования

- Node.js **>= 22** (проект ESM: `"type": "module"`)
- Токен Tinkoff Invest API с доступом к чтению портфеля
- Ключ LLM-провайдера (GigaChat, OpenAI или совместимый)

## Запуск

```bash
npm install
cp .env.example .env      # заполните токены
npm run build
npm start                 # http://localhost:3000/api/v1
```

```bash
npm test                  # unit-тесты (Jest, ESM)
npm run test:e2e          # e2e на тестовом MCP-сервере
npm run lint
```

## API

- `POST /api/v1/agent/chat` — вопрос агенту (`200` — ответ, `202` — нужно подтверждение);
- `POST /api/v1/agent/chat/approve` — решение по подтверждению (`approved: true|false`);
- `GET /api/v1/health` — состояние LLM и каждого MCP-сервера.

Примеры `curl` и таблица кодов ошибок — в [`docs/api.md`](docs/api.md). Подробности о трассировке и логах — в [`docs/observability.md`](docs/observability.md).

## Конфигурация

Все переменные читаются один раз при старте и проверяются zod-схемой (`src/config/env.schema.ts`). Некорректная конфигурация — падение с перечнем **всех** проблемных переменных (значения секретов в вывод не попадают).

### Приложение

| Переменная | По умолчанию | Описание |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `production` \| `test` |
| `PORT` | `3000` | HTTP-порт |
| `LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `LOG_QUESTION_TEXT` | `false` | Логировать текст вопросов пользователя |
| `USER_ID` | `default` | Пространство имён глобального хранилища |

### LLM

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LLM_PROVIDER` | — (обязательна) | `gigachat` \| `openai` \| `openai-compatible` |
| `LLM_MODEL` | — (обязательна) | Модель для ответов |
| `LLM_ROUTER_MODEL` | = `LLM_MODEL` | Модель для классификации вопроса |
| `LLM_TEMPERATURE` | `0.2` | Температура (0–2) |
| `LLM_API_KEY` | — | Обязательна для `openai` и `openai-compatible` |
| `LLM_BASE_URL` | — | Обязательна для `openai-compatible` |
| `GIGACHAT_CREDENTIALS` | — | Обязательна для `gigachat` |
| `GIGACHAT_SCOPE` | `GIGACHAT_API_PERS` | Скоуп GigaChat API |
| `GIGACHAT_AUTH_URL` | публичный OAuth | Адрес авторизации (меняется для внутреннего контура) |

Креденшелы проверяются только для выбранного провайдера.

### MCP

Список серверов задаётся одной переменной, а параметры — по шаблону `MCP_<NAME>_*`:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `MCP_SERVERS` | — (обязательна) | Имена серверов через запятую, например `tinkoff` |
| `MCP_<NAME>_URL` | — (обязательна) | URL MCP-сервера |
| `MCP_<NAME>_TRANSPORT` | `http` | `http` (streamable) \| `sse` |
| `MCP_<NAME>_TOKEN` | — | Bearer-токен сервера |
| `MCP_<NAME>_ALLOWED_TOOLS` | — (обязательна) | Allowlist инструментов; торговые и денежные операции запрещены |
| `MCP_<NAME>_TLS_MODE` | `strict` | `strict` \| `extra-ca` (доп. CA) \| `insecure` (без проверки, только для MCP) |
| `MCP_<NAME>_CA_FILE` | — | PEM-файл с CA; обязателен при `TLS_MODE=extra-ca` |
| `TINKOFF_ACCOUNT_ID` | — | Счёт по умолчанию; если пусто, агент узнаёт его через MCP |

### Состояние и подтверждения

| Переменная | По умолчанию | Описание |
|---|---|---|
| `STATE_BACKEND` | `sqlite` | `sqlite` \| `memory` (для тестов) |
| `STATE_SQLITE_PATH` | `./data/state.sqlite` | Файл состояния |
| `STATE_TTL_DAYS` | `30` | Удаление сессий, не обновлявшихся дольше |
| `APPROVAL_TTL_MINUTES` | `15` | Срок жизни запроса на подтверждение |
| `APPROVAL_UNLISTED` | `require` | Политика для действий без правила: `require` \| `allow` |
| `APPROVALS_FILE` | — | JSON-файл, заменяющий встроенные правила подтверждений |

### Наблюдаемость

| Переменная | По умолчанию | Описание |
|---|---|---|
| `LANGSMITH_TRACING` | `false` | Включить трассировку |
| `LANGSMITH_API_KEY` | — | Обязательна при включённой трассировке |
| `LANGSMITH_PROJECT` | `invest-analytic` | Проект в LangSmith |
| `LANGSMITH_ORG_ID` | — | Организация для ссылки на трейс |
| `LANGSMITH_HIDE_INPUTS` | `false` | Не отправлять содержимое промптов в трейсы |
| `LANGSMITH_TRACE_URL_TEMPLATE` | ссылка Smith | Шаблон `traceUrl` (`{orgId}`, `{project}`, `{runId}`) |

## Примеры для провайдеров

```dotenv
# GigaChat
LLM_PROVIDER=gigachat
LLM_MODEL=GigaChat-2-Max
LLM_ROUTER_MODEL=GigaChat-2
GIGACHAT_CREDENTIALS=<base64 client_id:client_secret>
GIGACHAT_SCOPE=GIGACHAT_API_PERS

# OpenAI
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=sk-...

# Любой OpenAI-совместимый шлюз
LLM_PROVIDER=openai-compatible
LLM_MODEL=qwen2.5-72b-instruct
LLM_API_KEY=...
LLM_BASE_URL=https://llm.internal.example.com/v1
```

## Как добавить MCP-сервер

1. Добавьте имя в `MCP_SERVERS`: `MCP_SERVERS=tinkoff,news`.
2. Заполните параметры нового сервера:

```dotenv
MCP_NEWS_URL=https://news-mcp.example.com/mcp
MCP_NEWS_TRANSPORT=http
MCP_NEWS_TOKEN=<токен>
MCP_NEWS_ALLOWED_TOOLS=search_news,get_article
```

3. Перезапустите сервис — инструменты появятся у агента с префиксом `news__`.
4. Если действие должно требовать подтверждения, добавьте правило в `src/agent/approvals/approval-rules.ts` (или в файл из `APPROVALS_FILE`).

Код графа и роутеров при этом не меняется.

## Структура

```
src/
  config/    env-схема и типизированный доступ к конфигурации
  api/       HTTP-контроллеры (чат, подтверждение, health)
  agent/     граф LangGraph, узлы, промпты, правила подтверждений
  llm/       реестр LLM-провайдеров
  tools/     реестр MCP-серверов, адаптер инструментов, мапперы
  state/     чекпоинтер и глобальное хранилище
  observability/  трассировка LangSmith и логи
test/unit, test/e2e, test/fixtures
```

## Ограничения MVP

- Доступ к данным — только чтение: торговые и денежные операции MCP запрещены и на уровне allowlist, и в правилах подтверждений.
- Поддерживается только состав портфеля. Аналитика по отдельным бумагам, новости, макро, налоги, ставка ЦБ, инвест-идеи и Пульс — следующие итерации.
- Подтверждение требуется на **каждый** запрос, читающий данные портфеля; ранее данное согласие не переносится.
- Состояние сессий хранится в SQLite (`STATE_BACKEND=sqlite`), история в памяти процесса доступна только при `STATE_BACKEND=memory` и теряется при перезапуске.
- Нет UI, стриминга ответа и мультипользовательской авторизации: `USER_ID` задаётся конфигурацией.

## Статус

Реализовано: каркас и конфигурация, реестр LLM-провайдеров (gigachat/openai/openai-compatible), реестр MCP-серверов с allowlist и бюджетом вызовов, граф `classify → (off-topic | agent ⇄ approve → tools)`, подтверждения через `interrupt`, HTTP-слой с `202/409/410`, health, SQLite-персистентность, маскирование секретов и `traceUrl`.

Проверки: `npm run build`, `npm test` (unit), `npm run test:e2e` (граф, MCP, HTTP, рестарт состояния), `npm run lint`, `npm run smoke:mcp` (живой MCP).

Планирование и спецификации — в [`openspec/changes/portfolio-analyst-agent-mvp/`](openspec/changes/portfolio-analyst-agent-mvp/).

