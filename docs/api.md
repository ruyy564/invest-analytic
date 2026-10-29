## API

```bash
# Вопрос агенту
curl -s -X POST http://localhost:3000/api/v1/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"что у меня в портфеле?"}'

# Ответ, если данных не нужно (или после подтверждения)
# 200 {"status":"completed","intent":"off_topic","answer":"...","requestId":"...","sessionId":"..."}

# Ответ, если нужно подтверждение
# 202 {"status":"awaiting_approval","intent":"portfolio","sessionId":"<uuid>",
#      "approval":{"question":"...","actions":[{"tool":"tinkoff__invest_get_portfolio","label":"...","args":{...}}]}}

# Подтвердить чтение данных
curl -s -X POST http://localhost:3000/api/v1/agent/chat/approve \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","approved":true}'

# Отклонить
curl -s -X POST http://localhost:3000/api/v1/agent/chat/approve \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","approved":false}'

# Состояние зависимостей
curl -s http://localhost:3000/api/v1/health
```

### Коды ошибок

| Код | HTTP | Причина |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Пустое или слишком длинное сообщение, некорректный `sessionId` |
| `NOT_AWAITING_APPROVAL` | 409 | У сессии нет ожидающего подтверждения |
| `APPROVAL_EXPIRED` | 410 | Подтверждение пришло позже `APPROVAL_TTL_MINUTES` |
| `mcp_unavailable` / `mcp_unauthorized` / `mcp_rate_limited` / `mcp_invalid_response` | 503 | Проблема на стороне MCP |
| `INTERNAL_ERROR` | 500 | Прочее; в теле нет стектрейсов и секретов |

Формат ошибки всегда один: `{"error": {"code": "...", "message": "...", "requestId": "..."}}`.
