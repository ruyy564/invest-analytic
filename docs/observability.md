# Наблюдаемость

## Переменные

| Переменная | Назначение |
|---|---|
| `LANGSMITH_TRACING` | Включает трассировку (при `true` обязателен ключ) |
| `LANGSMITH_API_KEY` | Ключ LangSmith |
| `LANGSMITH_PROJECT` | Проект, в который пишутся прогоны |
| `LANGSMITH_ORG_ID` | Организация — нужна для сборки `traceUrl` |
| `LANGSMITH_TRACE_URL_TEMPLATE` | Шаблон ссылки с `{orgId}`, `{project}`, `{runId}` |
| `LANGSMITH_HIDE_INPUTS` | Не отправлять содержимое промптов в трейсы |
| `LOG_LEVEL` | Уровень логов pino (`debug`, `info`, `warn`, `error`) |
| `LOG_QUESTION_TEXT` | Логировать текст вопроса (по умолчанию выключено) |
| `STATE_RUNS_DIR` | Каталог журналов прогонов (JSONL, по файлу на `runId`) |

## Что попадает в трейс

- корневой прогон на каждый запрос с метаданными `requestId`, `sessionId`;
- спаны узлов графа: `classify`, `offTopic`, `agent`, `approve`, `tools`;
- спаны вызовов модели (роли `answer` и `router`);
- спаны вызовов инструментов MCP с именем `<server>__<tool>`.

LangGraph и LangChain трассируются автоматически: узлы и инструменты — это runnable-объекты, поэтому отдельная обёртка не нужна. Метаданные `requestId`/`sessionId` задаются в конфиге запуска графа (`configFor`), поэтому попадают во все дочерние спаны.

## Ссылка на трейс

`traceUrl` собирается из `LANGSMITH_TRACE_URL_TEMPLATE` по `runId`, `orgId` и проекту:

```
https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}
```

`runId` генерирует сам сервис до запуска графа (`randomUUID`) и передаёт его в
`config.metadata`. Поэтому ссылка строится сразу после прогона: опрос LangSmith
(`resolveRootRunId`) больше не используется, сетевых запросов для ссылки нет.

`orgId` берётся из `LANGSMITH_ORG_ID`, а если не задан — один раз запрашивается
у LangSmith по ключу (`resolveOrgId`) и кэшируется на процесс.

Ссылки нет, если трассировка выключена или в шаблоне нужен `{orgId}`, а получить
его не удалось.

## Проверка трейса

`npm run trace -- <runId>` (или `node --env-file=.env scripts/trace-report.mjs <runId>`) печатает корневой прогон, его метаданные (`requestId`, `sessionId`) и дерево спанов со статусами — удобно, когда ссылку нужно проверить без UI.

Проверенные сценарии (живой прогон, T-Invest MCP + GigaChat):

| Сценарий | Корневой прогон и спаны |
|---|---|
| `POST /chat` (нужно подтверждение) | `LangGraph` → `__start__`, `classify`, `agent`, `approve` (прерывание) |
| `POST /chat/approve` (подтверждено) | `LangGraph` → `approve`, `tools` → `tinkoff__invest_get_portfolio`, `agent`, `GigaChat` |
| `POST /chat/approve` (отказ) | `LangGraph` → `approve`, `agent`, `GigaChat` — данные не читаются |
| off-topic | `LangGraph` → `__start__`, `classify`, `offTopic` — без доступа к данным |

Спан `approve` в первом прогоне показывает «ошибку» с `GraphInterrupt`: LangGraph прерывает узел, чтобы вернуть управление клиенту — это не сбой сервиса, и по `traceUrl` из `202` видно, где прогон остановился.

## Логи

Логи пишутся структурированно (pino, JSON-строки в stdout), уровень — `LOG_LEVEL`.
Nest-логгеры (`new Logger('ClassifyNode')`) автоматически попадают в тот же поток
через `app.useLogger`, поэтому переписывать вызовы в узлах не нужно.

Поля записи:

| Поле | Смысл |
|---|---|
| `time`, `level`, `msg`, `service`, `env` | стандартные поля pino |
| `context` | имя класса/узла из Nest-логгера |
| `runId` | идентификатор прогона: связывает лог, журнал и трейс |
| `requestId`, `sessionId` | запрос и диалог |
| `intent` | сценарий прогона (когда известен) |
| `durationMs`, `tools`, `errorCode` | метрики этапа и ошибки |

`runId` попадает в записи автоматически: `AgentRunnerService` оборачивает прогон
в `withLogContext`, а мост `toNestLogger` добавляет поля контекста в каждую
запись. Текст вопроса попадает в лог только при `LOG_QUESTION_TEXT=true`.

Маскирование: `src/platform/logging/redact.ts` маскирует поля с именами `token`,
`authorization`, `apiKey`, `secret`, `password`, `credentials` и Bearer-токены в
тексте сообщения. Pino применяет те же правила к полям по путям.

## Журнал прогона

Каждый прогон пишет JSONL-файл `STATE_RUNS_DIR/<runId>.jsonl` (по умолчанию
`./.state/runs`):

```json
{"at":"2026-11-06T10:00:00.000Z","type":"run_started","sessionId":"s-1"}
{"at":"2026-11-06T10:00:03.000Z","type":"run_finished","intent":"portfolio_review","status":"completed","partial":false,"tools":["portfolio__snapshot"],"coverage":[{"source":"get_portfolio","status":"ok"}],"stopReason":"answered","usage":{"inputTokens":120,"outputTokens":40},"durationMs":3000}
```

`stopReason`: `answered`, `approval`, `budget`, `guard`, `no_data`, `error`.
Ошибка записи журнала не прерывает прогон — в лог уходит предупреждение.

Транскрипт по журналу печатает команда (сеть не нужна):

```bash
npm run replay -- <runId>
```

## Метрики

`summarizeRuns` (`src/platform/runs/metrics.ts`) агрегирует записи журнала по
интентам: число прогонов, доля частичных результатов, доля отказов модели, доля
ошибок инструментов и источников, стоимость, p50/p95 задержки. Функция чистая —
её можно вызвать на выгрузке журналов без запуска сервиса.

## Сбои

Экспорт трейса не является частью ответа: если LangSmith недоступен, запрос всё равно завершается, а в лог пишется предупреждение. Трассировка не блокирует и не ломает прогон.
