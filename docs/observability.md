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

LangGraph и LangChain трассируются автоматически: узлы и инструменты — это runnable-объекты, поэтому отдельная обёртка не нужна. Наш слой добавляет к прогону `RunCollector` (callback), который запоминает идентификатор корневого прогона.

## Ссылка на трейс

`traceUrl` собирается из `LANGSMITH_TRACE_URL_TEMPLATE` по `runId`, `orgId` и проекту:

```
https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}
```

Ссылки нет, если трассировка выключена, `runId` не получен или в шаблоне нужен `{orgId}`, а `LANGSMITH_ORG_ID` не задан.

## Логи

Запись содержит `requestId`, `sessionId`, интент, длительность этапа, имена вызванных инструментов и код ошибки. Текст вопроса попадает в лог только при `LOG_QUESTION_TEXT=true` и проходит через `redactString` (Bearer-токены маскируются).

`src/observability/redact.ts` рекурсивно маскирует поля с именами `token`, `authorization`, `apiKey`, `secret`, `password`, `credentials`, оставляя от значения только два первых и два последних символа.

## Сбои

Экспорт трейса не является частью ответа: если LangSmith недоступен, запрос всё равно завершается, а в лог пишется предупреждение. Трассировка не блокирует и не ломает прогон.
