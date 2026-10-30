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
| `LOG_QUESTION_TEXT` | Логировать текст вопроса (по умолчанию выключено) |

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

`runId` — идентификатор корневого прогона графа. LangChain не отдаёт его в колбэках (`handleChainStart` приходит только для вложенных runnable), поэтому после `invoke` сервис читает свежие прогоны имени `LangGraph` из проекта (`resolveRootRunId` в `src/observability/run-collector.ts`): до 5 попыток с паузой 800 мс — экспорт асинхронный. Выбирается прогон с совпадающим `requestId`; прогоны без метаданных берутся только если точного совпадения не нашлось ни в одной попытке — иначе ссылка уводила бы в чужой трейс. Явный флаг `isRoot` не используется: `__start__` тоже считается корневым, а собственные корневые узлы инструментов пишутся отдельными трейсами.

`orgId` берётся из `LANGSMITH_ORG_ID`, а если не задан — из `GET /api/v1/orgs/current` по `LANGSMITH_API_KEY` (`resolveOrgId`).

Ссылки нет, если трассировка выключена, `runId` не получен или в шаблоне нужен `{orgId}`, а получить его не удалось.

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

Запись содержит `requestId`, `sessionId`, интент, длительность этапа, имена вызванных инструментов и код ошибки. Текст вопроса попадает в лог только при `LOG_QUESTION_TEXT=true` и проходит через `redactString` (Bearer-токены маскируются).

`src/observability/redact.ts` рекурсивно маскирует поля с именами `token`, `authorization`, `apiKey`, `secret`, `password`, `credentials`, оставляя от значения только два первых и два последних символа.

## Сбои

Экспорт трейса не является частью ответа: если LangSmith недоступен, запрос всё равно завершается, а в лог пишется предупреждение. Трассировка не блокирует и не ломает прогон.
