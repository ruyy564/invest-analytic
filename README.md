# invest-analytic

Агент-аналитик портфеля Tinkoff Invest: **NestJS 12 + LangGraph 1.x + MCP**.

Агент отвечает на вопрос «что у меня в портфеле» строго по данным брокера, запрашивает подтверждение перед каждым чтением и пишет трейсы в LangSmith. Провайдер LLM и MCP-серверы подключаются только конфигурацией.

> Все 61 задача MVP закрыты и проверены вживую (локально и в Docker). Спецификации — в [`openspec/specs/`](openspec/specs/), завершённое изменение — в `openspec/changes/archive/2026-10-29-portfolio-analyst-agent-mvp/`.

## Как это работает

```
POST /api/v1/agent/chat
        │
        ▼
   classify (LLM-роутер) ── off_topic ──────────▶ offTopic ─▶ ответ без доступа к данным
        │
        ├── data_lookup / security_analysis ─────▶ agent (LLM + инструменты MCP)
        │                                              │ просит вызвать инструмент
        │                                              ▼
        │                                          approve (interrupt) ─▶ 202 + действия
        │                                              │ approve
        │                                              ▼
        │                                          tools (MCP) ─▶ agent ─▶ ответ
        │
        ├── agent_help ──────────────────────────▶ help (справка о возможностях) ─▶ ответ без данных
        │
        ├── knowledge_question ──────────────────▶ knowledge (объяснение понятия) ─▶ ответ из базы знаний
        │
        ├── market_news ─────────────────────────▶ news (сводка по периодам) ─▶ ответ без портфеля
        │
        └── portfolio_review ──▶ plan (план чтений) ─▶ approve (один запрос на весь план)
                                                        │ approve
                                                        ▼
                                   collect (пачки, бюджет, покрытие) ─▶ report
                                                        │ шаблон + поставщики фактов
                                                        │ один вызов модели: «макро» и «итог»
                                                        ▼
                                        отчёт + reportId ─▶ 200 completed
```

- **Граф** — LangGraph с чекпоинтером: прерывание на `approve` можно возобновить после перезапуска процесса.
- **Новости** — отдельная ветка `news`: «какие последние новости в мире инвестиций» → сводка
  по периодам (сегодня, неделя, месяц, полгода) из всех включённых источников. Портфель не
  читается, подтверждение не запрашивается, модель не вызывается — ответ собирается кодом.
  Пример: `{"message":"какие последние новости в мире инвестиций?"}` → `intent: "market_news"`,
  `report.type: "market_news"` с покрытием источников.
- **Справка** — отдельная ветка `help`: вопрос «что ты умеешь» получает карту возможностей
  с примерами вопросов и границами сервиса. Данные не читаются, подтверждение не
  запрашивается, модель не вызывается — текст собирается кодом из
  `src/agent/prompts/capabilities.ts`. Откат: `AGENT_HELP_ENABLED=false`.
- **База знаний** — каталог `data/knowledge/*.yaml`, по файлу на тему: циклы, макро,
  мультипликаторы, диверсификация, психология решений, зависимости секторов, металлы,
  история кризисов, чек-лист решений и литература. Разделы `macro`, `opinions`, `verdict`
  получают подобранный блок принципов (числа — только из брифинга), системный промпт
  агента — чек-лист, вопрос «что такое P/E» отвечает ветка `knowledge` без чтения данных.
  Подробности — `docs/knowledge.md`, откат — `KNOWLEDGE_ENABLED=false`.
Границы модулей, контракты расширения (инструмент, MCP-сервер, источник, провайдер фактов,
узел, тема знаний) и чек-лист ревью — в [`docs/architecture.md`](docs/architecture.md).
- **Подтверждение** — на каждое чтение данных портфеля; политика выводится из правил (`src/agent/approvals/approval-rules.ts`).
- **Инструменты** — `MultiServerMCPClient` + allowlist по серверу; имена вида `tinkoff__invest_get_portfolio`.
- **MCP-прокси** — `McpProxyService` поднимает `http://127.0.0.1:<port>/mcp`, говорит с T-Invest MCP по протоколу MCP (сессия, SSE → JSON) и отдаёт адаптеру обычный JSON. Нужен потому, что сервер отдаёт `tools/list` потоком SSE, который адаптер не досчитывает до конца. К апстриму ходит через `node:https`, поэтому `MCP_<NAME>_TLS_MODE`/`CA_FILE` применяются именно к этому соединению.
- **LLM** — реестр провайдеров по `LLM_PROVIDER`, две модели: роутер и ответчик.
- **Состояние** — SQLite (`data/state.db`), очистка по `STATE_TTL_DAYS`.
- **Наблюдаемость** — трейсы LangSmith по env, `traceUrl` в каждом ответе, структурные логи с маскированием секретов.

## Требования

- Node.js **>= 22** (проект ESM: `"type": "module"`)
- Токен T-Invest API с доступом к чтению портфеля
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

Через Docker (порт `3000`, состояние в `./data`, CA для T-Invest — из `./certs`):

```bash
node scripts/fetch-mcp-ca.mjs   # один раз: сохранит цепочку T-Invest в certs/mcp-chain.pem
docker compose up -d --build
docker compose ps                # ждём статус (healthy)
docker compose logs -f
docker compose down
```

`docker-compose.yml` явно передаёт `MCP_TINKOFF_URL`, `MCP_TINKOFF_TLS_MODE=extra-ca` и `MCP_TINKOFF_CA_FILE=/app/certs/mcp-chain.pem`, чтобы контейнер не зависел от локальных значений `.env`. В образе `better-sqlite3` собирается из исходников (`python3`, `make`, `g++`), если готового бинарника для платформы нет.

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
| `STATE_SQLITE_PATH` | `./.state/state.sqlite` | Файл состояния |
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
  main.ts        точка входа (bootstrap Nest)
  app.module.ts  корневой модуль
  api/           контроллеры, DTO, фильтр ошибок
  agent/         граф, узлы (nodes/<node>/), подтверждения, раннер
  knowledge/     база знаний: сервис, репозиторий, отбор, формат
  report/        шаблон, движок фактов, провайдеры, рендер
  collection/    план и исполнение сбора
  sources/       адаптеры источников (ЦБ, ленты)
  parsing/       парсинг ответов MCP и YAML
  mcp/           инфраструктура MCP: реестр, клиент, прокси, адаптер
  tools/<tool>/  сами тулы
  llm/, state/, observability/, config/, accounts/
test/unit, test/e2e, test/fixtures
data/            данные: темы знаний, словари, сиды
reports/         шаблон отчёта и промпт интерпретации
.agents/         инструкции агентов и скиллы (openspec-checkpoint и др.)
```

Подробная карта «где что искать» и контракты расширения — в [`docs/architecture.md`](docs/architecture.md).

### Гигиена рабочего дерева

Временные артефакты прогонов, сборки и тестов убираются одной командой:

```bash
node scripts/clean-temp.mjs        # показать, что будет удалено
node scripts/clean-temp.mjs --yes  # удалить
```

Скрипт трогает только закрытый список (логи, `*.tsbuildinfo`, `tmp/`, `coverage/`,
`.browser-profile/`, `.langgraph_api/` и подобное) и никогда не удаляет код, `data/`,
`certs/`, `dist/` и `node_modules/`. После каждого этапа OpenSpec это делает скилл
`openspec-checkpoint`: чистит дерево, проверяет этап и коммитит его с сообщением по шаблону.

## Трейсы и Studio (LangSmith)

**Трейсы.** Каждый ответ API содержит `traceUrl` — ссылку на прогон графа этого запроса (спаны `classify`, `agent`, `approve`, `tools`, вызовы модели и инструментов). Проверка без UI: `npm run trace -- <runId из traceUrl>`.

**Studio.** В LangSmith Studio запускается **рабочий агент** — тот же граф, что в сервисе:

```bash
npm run studio        # собирает проект и поднимает LangGraph Server на 127.0.0.1:2024
npm run studio:open   # открывает Studio во вкладке VS Code (внешний браузер не запускается)
npm run studio:check  # проверка через API сервера: тред, история, подтверждение
```

`npm run studio` больше не открывает браузер сам (`--no-browser`). `npm run studio:open` открывает Studio **в отдельном окне** браузера с изолированным профилем:

- используется Chromium-браузер (Chrome → Edge → Яндекс) в режиме `--app`: окно без адресной строки и без ваших вкладок;
- профиль отдельный — `.browser-profile/` в репозитории (в `.gitignore`), ваша основная сессия и открытые окна не затрагиваются;
- вход в LangSmith в этом окне нужен один раз, дальше профиль его помнит.

Альтернатива без внешнего окна: клик по ссылке в терминале (`workbench.browser.openLocalhostLinks` включён в `.vscode/settings.json`) или `Ctrl+Shift+P` → «Simple Browser: Show». Автоматически открыть встроенную вкладку VS Code нельзя: в 1.144 `code --open-url` возвращает успех, но вкладку не создаёт.

Сервер печатает ссылку `https://smith.langchain.com/studio?baseUrl=http://127.0.0.1:2024` — открыть в браузере, где вы вошли в LangSmith. Вкладка **Chat** — полноценный диалог: вопрос уходит в `classify`, модель вызывает `portfolio_all_accounts` (сводка по всем открытым счетам), граф встаёт на `approve`, в панели Interrupt виден запрос, после решения кнопкой **Resume** прогон продолжается и приходит ответ по реальным данным брокера.

**Как подтвердить.** В панели Interrupt есть поле значения (по умолчанию в нём `""` — это отказ). Впишите объект решения и нажмите **Resume**:

```json
{"approved": true}
```

Отказ — `{"approved": false}` (данные не запрашиваются, агент предложит подтвердить). Пустое значение, `""` и любой другой мусор тоже считаются отказом: подтверждение без явного «да» не принимается. Принимаются также `true`, `"да"`, `"{\"approved\": true}"` — разбор терпимый (`isApprovedDecision` в `src/agent/nodes/approve.node.ts`).

**Что видит агент.** `MCP_TINKOFF_ALLOWED_TOOLS` — это allowlist: инструменты вне списка агенту недоступны (и в Studio их не будет). При старте `npm run studio` печатает фактический список, например `Агенту доступно инструментов: 17 — tinkoff__invest_get_candles, …`. Если вопрос про бумагу вызывает «не вижу данных», сначала проверьте этот список.

Область ассистента — портфель **и** рыночные данные: состав и стоимость, доходность, цены и динамика бумаг, дивиденды, фундаментал, новости. Всё остальное (погода, политика, налоги, сделки) уходит в детерминированный отказ без вызова инструментов — поэтому там не появляется и запрос подтверждения. На вопрос «что ты умеешь» отвечает фиксированный список возможностей (`CAPABILITIES_ANSWER`): на общий вопрос GigaChat отвечает своей «визиткой», игнорируя системный промпт.

Два инструмента собирает само приложение:

| Инструмент | Что делает |
|---|---|
| `portfolio_all_accounts` | `invest_list_accounts` → по каждому счёту `invest_get_portfolio` (итог, доходность) + `invest_get_positions` (бумаги) → пакетный `invest_get_market_values` (цена) → стоимость позиции = цена × количество |
| `price_dynamics` | `invest_find_instrument` → `invest_get_candles` (дневные) → изменение за период в валюте и процентах, минимум/максимум с датами |

Оба считают числа кодом, а модель их пересказывает: иначе она «вспоминает» чужие цены вместо данных брокера. Доходность (`expectedYield`, `dailyYield`) берётся из ответа брокера и не пересчитывается. Если цену получить не удалось, позиция показывается без стоимости, а не с нулём.

**Лимиты времени** (чтобы прогон не «висел»):

| Что | Предел |
|---|---|
| классификация вопроса | 8 с, при сбое вопрос идёт как `portfolio` |
| ответ модели | 15 с |
| один вызов MCP-инструмента | 8 с |
| ожидание подтверждения | 15 мин (`APPROVAL_TTL_MINUTES`) |
| прогон через HTTP-API | 30 с (`RUN_DEADLINE_MS`), бюджет 8 вызовов инструментов |

GigaChat по умолчанию работает **без SSE-потока**: `GIGACHAT_STREAMING=false`, плюс `disableStreaming` в модели. Иначе Studio включает поток через callbacks, клиент рвёт обрезанный чанк («Unterminated string in JSON») и повторяет запрос минутами — именно это выглядело как «ответ висит 2 минуты».

Перед первым запуском в `.env` должны быть настройки TLS до MCP T-Invest (иначе `npm run studio` упадёт с понятной ошибкой «MCP недоступен»):

```
MCP_TINKOFF_TLS_MODE=extra-ca
MCP_TINKOFF_CA_FILE=certs/mcp-chain.pem
```

Точка входа — `src/agent/agent.server.ts` (аналог `investServer.ts` из примера курса), конфигурация — `langgraph.json`:

```ts
export const graph = await graphForServer();
```

`graphForServer()` (`src/agent/agent-runtime.ts`) собирает вне NestJS те же зависимости: `loadConfiguration()` — ту же zod-схему `.env`, `LlmRegistry` (провайдер и две модели из `LLM_PROVIDER`/`LLM_MODEL`/`LLM_ROUTER_MODEL`), `McpRegistryService` (allowlist, прокси, TLS-режимы, бюджет вызовов), `ApprovalPolicyService` (правила подтверждений), счёт из `TINKOFF_ACCOUNT_ID`. Сам граф — тем же `buildAgentGraph`. Чекпоинтер не передаётся: персистентность треда держит сам dev-сервер LangGraph.

Привязка к `127.0.0.1` обязательна: по умолчанию CLI слушает `localhost` (IPv6 `::1`), и браузер не может достучаться до API. Нужен `@langchain/langgraph-api` в `devDependencies` (ставится с `--legacy-peer-deps` из-за peer `typescript@5`, у нас TypeScript 6).

## Ограничения

- Доступ к данным — только чтение: торговые и денежные операции MCP запрещены и на уровне allowlist, и в правилах подтверждений.
- Источник ключевой ставки — официальный SOAP-интерфейс ЦБ; при его недоступности используются кэш и сид-файл `data/key-rate-seed.json`, а раздел макро честно помечает происхождение данных.
- Инфляции, макрокалендаря и текстовых обзоров инвест-домов в источниках нет: фаза цикла и привлекательность секторов помечаются как `(оценка)`.
- Сектор бумаги берётся из справочника активов брокера (`brand.sector`); если брокер его не вернул, в разрезе честно выводится «сектор не определён» с указанием доли такого портфеля.
- Новости брокера отдаются лентой без фильтра по дате: период определяется по времени публикации, глубина ограничена `NEWS_SCAN_PAGES`.
- Подтверждение требуется заново на каждый вопрос, читающий данные; внутри одного разбора план подтверждается один раз.
- Состояние сессий и отчётов хранится в SQLite (`.state/state.sqlite`, `STATE_BACKEND=sqlite`); при `STATE_BACKEND=memory` история теряется при перезапуске.
- Одна сессия = один `USER_ID` из конфигурации: мультипользовательской авторизации нет.
- Нет UI и стриминга ответа: ответ приходит одним JSON после подтверждения. Дедлайн прогона — `RUN_DEADLINE_MS` (90 с), клиентский таймаут должен быть больше.
- Лимиты прогона — `RUN_TOOL_MAX_CALLS` (40), `RUN_DEADLINE_MS` (90 с), `RUN_PARALLELISM` (4), `REVIEW_MAX_INSTRUMENTS` (15); при исчерпании ответ помечается `partial: true`.
- TLS до T-Invest MCP требует дополнительного CA (`MCP_TINKOFF_TLS_MODE=extra-ca`, файл из `scripts/fetch-mcp-ca.mjs`).
- `REVIEW_ENABLED=false` возвращает прежнее поведение: две метки, только сводка по счетам, без ветки разбора.

## Статус

Реализовано: конфигурация с проверкой zod, реестр LLM-провайдеров (gigachat/openai/openai-compatible), реестр MCP-серверов с allowlist, бюджетом вызовов и локальным прокси, граф `classify → (offTopic | agent ⇄ approve → tools)`, подтверждения через `interrupt` с возобновлением после рестарта, HTTP-слой (`202/409/410`, единый формат ошибок), health, SQLite-персистентность с очисткой TTL, маскирование секретов, трейсы LangSmith и `traceUrl`.

Проверено вживую (T-Invest MCP + GigaChat): `POST /chat` → `202 awaiting_approval` с действием `tinkoff__invest_get_portfolio`, `POST /chat/approve` → `200 completed` с отчётом и дисклеймером, `GET /health` → `ok` (`llm: up`, `mcp:tinkoff: up`), `traceUrl` открывает прогон со спанами `classify`, `agent`, `tools`, `approve`.

Проверки: `npm run build`, `npm test` (104 unit), `npm run test:e2e` (22 e2e: граф, MCP, HTTP, рестарт состояния, пустой портфель, off-topic, невалидный ввод, fail-open трассировки), `npm run lint`, `npm run smoke:mcp` (живой MCP, см. [`docs/mcp.md`](docs/mcp.md)), `npm run studio` + `npm run studio:check` (живой агент в LangSmith Studio).

Проверено в Docker: `docker compose up -d --build` → контейнер `healthy`, `GET /health` → `ok`, «вопрос → подтверждение → ответ» → `202`/`200`, подтверждение после `docker compose restart` продолжает прогон (состояние в `./data`).

Планирование и спецификации — в [`openspec/specs/`](openspec/specs/) (основные спеки) и [`openspec/changes/archive/2026-10-29-portfolio-analyst-agent-mvp/`](openspec/changes/archive/2026-10-29-portfolio-analyst-agent-mvp/) (предложение, дизайн и задачи реализованного MVP).

