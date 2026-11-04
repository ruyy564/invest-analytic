## API

```bash
# Вопрос агенту
curl -s -X POST http://localhost:3000/api/v1/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"что у меня в портфеле?"}'

# Ответ, если данных не нужно (или после подтверждения)
# 200 {"status":"completed","intent":"data_lookup","scope":"portfolio","answer":"...","requestId":"...","sessionId":"...",
#      "report":{"reportId":"<uuid>","type":"deep_review","asOf":"2026-11-04T12:00:00Z",
#                "coverage":[{"source":"market__news_digest","status":"ok"},
#                            {"source":"cbr","status":"missing","reason":"..."}]}}

# Ответ, если нужно подтверждение
# 202 {"status":"awaiting_approval","intent":"portfolio_review","sessionId":"<uuid>",
#      "scope":"instrument","scopeTarget":"SBER","scopeLabel":"бумаги SBER",
#      "approval":{"question":"Прочитать 25 видов данных для разбора бумаги SBER (счета, состав и стоимость портфеля, ...)?",
#                  "actions":[{"tool":"portfolio__review","label":"Разбор портфеля",
#                              "args":{"requests":24,"groups":["accounts","portfolio","news"],
#                                      "accounts":["<accountId>"]}}]}}

# Подтвердить чтение данных (в том числе весь план разбора)
curl -s -X POST http://localhost:3000/api/v1/agent/chat/approve \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","approved":true}'

# Отклонить
curl -s -X POST http://localhost:3000/api/v1/agent/chat/approve \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","approved":false}'

# Выгрузить готовый отчёт: md (по умолчанию) | json | html
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=json"

# Состояние зависимостей
curl -s http://localhost:3000/api/v1/health
```

### Значения `intent`

| Значение | Что означает | Ветка графа |
|---|---|---|
| `data_lookup` | точечный вопрос по данным (состав, цена, дивиденды, новости бумаги) | `agent ⇄ approve → tools` |
| `security_analysis` | разбор или сравнение бумаг | `agent ⇄ approve → tools` |
| `portfolio_review` | глубокий разбор: портфель, счёт или бумага — цикл, секторы, налоги, мнения | `plan → approve → collect → report` |
| `market_news` | сводка новостей инвестиционного рынка по периодам | `news` |
| `off_topic` | посторонняя тема или просьба совершить сделку | `offTopic` |

Новостная ветка не читает портфель и не запрашивает подтверждение: ответ
собирается из публичных источников. Метаданные приходят в блоке `report` с
`type: "market_news"`, временем данных и покрытием источников — без `reportId`,
потому что сводка не сохраняется как отчёт:

```json
{"status":"completed","intent":"market_news","answer":"Новости инвестиционного рынка …",
 "report":{"type":"market_news","asOf":"2026-11-04T20:00:00Z",
           "coverage":[{"source":"rbc","status":"ok"},{"source":"bcs","status":"missing","reason":"HTTP 429"}]}}
```

Область глубокого разбора приходит в ответе полями `scope` (`portfolio` | `account` |
`instrument`), `scopeTarget` (тикер или счёт) и `scopeLabel` (подпись отчёта).
Примеры вопросов: `проанализируй мой портфель`, `разбери счёт 2083155697`,
`разбери бумагу SBER`.

### Время ответа

Дедлайн прогона — `RUN_DEADLINE_MS` (по умолчанию 240 с для разбора). Клиент
должен задавать таймаут больше этого значения: разбор читает данные по счетам
и бумагам и делает отдельный вызов модели на каждый раздел интерпретации.

### Коды ошибок

| Код | HTTP | Причина |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Пустое или слишком длинное сообщение, некорректный `sessionId` |
| `REPORT_NOT_FOUND` | 404 | Отчёт не найден или принадлежит другому пользователю |
| `NOT_AWAITING_APPROVAL` | 409 | У сессии нет ожидающего подтверждения |
| `APPROVAL_EXPIRED` | 410 | Подтверждение пришло позже `APPROVAL_TTL_MINUTES` |
| `mcp_unavailable` / `mcp_unauthorized` / `mcp_rate_limited` / `mcp_invalid_response` | 503 | Проблема на стороне MCP |
| `INTERNAL_ERROR` | 500 | Прочее; в теле нет стектрейсов и секретов |

Формат ошибки всегда один: `{"error": {"code": "...", "message": "...", "requestId": "..."}}`.

