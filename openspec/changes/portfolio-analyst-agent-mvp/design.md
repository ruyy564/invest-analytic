# Design

## Context

См. `proposal.md` — Why. Репозиторий пустой: `package.json` нет, поэтому каркас NestJS тоже часть работы.

Референс реализации — `D:\репозитории\langgraph-course` (LangGraph 1.x). Оттуда берём проверенные приёмы: состояние на `StateSchema` + `MessagesValue`, `ToolNode`, топология `classify → (notInScope | agent ⇄ tools)`, разделение «дешёвая модель для классификации / умная для ответа», фолбэк классификатора на текстовый ответ, LangSmith через переменные окружения. Грабли из примера учитываем в решениях: двойное форматирование инструментов в `bindTools` у GigaChat и сосуществование zod 3 / zod 4.

Ограничения: доступ к данным только через MCP (read-only), один процесс, без БД, без UI.

## Goals / Non-Goals

**Goals:**

- Работающий каркас, который поднимается одной командой и отвечает на вопрос о составе портфеля по реальным данным брокера.
- Два расширяемых шва: LLM-провайдер и MCP-серверы — оба настраиваются только через `.env`.
- Предсказуемость: allowlist инструментов, лимиты прогона, отказ по темам вне области.

**Non-Goals:**

- Аналитика по отдельной бумаге, фундаментал, дивиденды, новости, макро, налоги, ставка ЦБ, аналитика инвест-домов, Пульс.
- Торговые операции, персистентная история диалогов, стриминг (SSE), UI, мультипользовательская авторизация.

## Decisions

### 1. Слои NestJS и направление зависимостей

`api` (контроллеры, DTO, фильтры) → `agent` (граф, узлы, промпты) → `tools` (реестр MCP и адаптеры инструментов) → `llm` и `observability` (провайдеры моделей, трейсинг, логи) → `config`.

- **Почему:** узлы графа не знают ни про HTTP, ни про MCP-транспорт; LLM-провайдер подключается через DI-токен, поэтому тесты подменяют модель и реестр инструментов без сети.
- **Альтернатива:** один сервисный класс (как `investServer.ts` в примере) — быстрее стартовать, но провайдеры и MCP пришлось бы связывать вручную и нельзя переиспользовать в тестах.
- Платформа — `@nestjs/platform-express`: узкое место — LLM и сеть, а не HTTP-слой.

### 2. Граф LangGraph как в примере, но с подтверждением и лимитами

```
START → classify ─┬─ offTopic ───────────────────────────→ END
                  └─ agent ⇄ approve ──→ tools ──→ agent
                       └─ (нет tool_calls) ────────────→ END
```

- Состояние: `new StateSchema({ messages: MessagesValue, intent: z.enum(["portfolio","off_topic"]).default("off_topic") })` плюс поля прогона `partial` и `dataAsOf`.
- Узлы: `classify`, `offTopic`, `agent`, `approve`, `tools` (`ToolNode` из `@langchain/langgraph/prebuilt`).
- Роутеры: `afterClassify` (по `state.intent`), `afterAgent` — `approve`, если среди `tool_calls` есть инструмент чтения портфеля, иначе `tools`; без `tool_calls` — `END`.
- Компиляция: `recursionLimit: 12` на вызов, `thread_id = sessionId`, чекпоинтер выбирается конфигурацией (см. «Персистентное состояние»).
- Лимиты поверх `recursionLimit`: обёртка инструментов считает вызовы (≤ 8) и общий дедлайн 30 с, при исчерпании возвращает `partial: true`.
- Счётчик бюджета и дедлайн хранятся в состоянии прогона, поэтому суммируются через паузу на подтверждении.
- **Почему:** топология из примера минимальна и покрывает требования «фильтр не по теме» и «подтверждение перед чтением» без отдельного планировщика.
- **Альтернатива:** `createReactAgent` — меньше кода, но не даёт вставить `classify`, `approve` и лимиты в нужные места.

### 3. Подтверждение перед чтением портфеля

- Узел `approve` использует `interrupt<ApprovePayload, ApproveDecision>({ question, actions })`: при подтверждении — `new Command({ goto: "tools" })`, при отказе — возврат в `agent` с `ToolMessage` на каждый `tool_call_id` (модель ждёт ответ на вызов, иначе граф зависает).
- `ApprovePayload`: `question`, `actions: { tool, args }[]`, `requestId`. Аргументы проходят через `redact`, токены и заголовки в payload не попадают.
- Триггер — модуль правил подтверждений (`approval-policy`), а не код роутера: `approval-policy.service.ts` получает список `tool_calls` и возвращает те, что требуют подтверждения. Новый источник данных попадает под аппрув правкой файла правил.
- Файл правил `src/agent/approvals/approval-rules.ts` — единственное место перечня:

```ts
export const APPROVAL_RULES: ApprovalRule[] = [
  {
    // служебное чтение: нужно, чтобы показать счёт в запросе подтверждения
    tool: "tinkoff__invest_list_accounts",
    label: "Список брокерских счетов",
    question: "Прочитать список ваших счетов у брокера?",
    requiresApproval: false,
  },
  {
    tool: "tinkoff__invest_get_portfolio",
    label: "Состав и стоимость портфеля",
    question: "Прочитать данные портфеля у брокера?",
    requiresApproval: true,
  },
  {
    tool: "tinkoff__invest_get_positions",
    label: "Позиции портфеля",
    question: "Прочитать позиции портфеля у брокера?",
    requiresApproval: true,
  },
];
```

- Сопоставление: полное имя или шаблон с `*` (`tinkoff__invest_*`), применяется первое совпавшее правило; для инструментов без правила действует `APPROVAL_UNLISTED` (`require` по умолчанию).
- Один аппрув на запрос: список счетов — служебное чтение (`requiresApproval: false`), поэтому пользователь видит одно подтверждение на портфель, а в payload уже указан конкретный счёт. Если задан `TINKOFF_ACCOUNT_ID`, список счетов не запрашивается вовсе.
- Проверка при старте: дубликаты, отсутствие `label`/`question`, ссылка на неизвестный инструмент и `requiresApproval: false` для торгового инструмента — ошибка конфигурации, а не тихое поведение.
- `APPROVALS_FILE` позволяет заменить встроенный набор JSON-файлом (тот же zod-схема), чтобы менять правила в контейнере без пересборки; файл валидируется на старте.
- Строгий режим: согласие не переносится на следующий вопрос и не хранится в глобальном хранилище — каждый запрос, требующий чтения, снова останавливается на `approve`.
- Продолжение: `POST /api/v1/agent/chat/approve` → `graph.invoke(new Command({ resume: decision }), { configurable: { thread_id: sessionId } })`.
- Возобновление перезапускает узел с начала, поэтому побочные эффекты до `interrupt` оборачиваются в `task()` (грабля из референса).
- Время постановки в `interrupt` пишется в состояние: при подтверждении позже `APPROVAL_TTL_MINUTES` сервис отвечает `410 APPROVAL_EXPIRED` и прогон не продолжает.
- **Почему `interrupt`, а не флаг согласия в приложении:** пауза durable — состояние лежит в чекпоинте, решение может прийти после перезапуска и из другого процесса.
- **Альтернатива:** спрашивать подтверждение до запуска графа — дешевле по токенам, но нельзя показать, какие именно данные и по какому счёту будут прочитаны.

### 4. Реестр LLM-провайдеров

Интерфейс `LlmProvider { id: string; createChatModel(role: "answer" | "router"): BaseChatModel }`, реализации в `src/llm/providers/`:

| Провайдер | Реализация | Обязательные переменные |
|---|---|---|
| `gigachat` | `langchain-gigachat` (`GigaChat`) | `GIGACHAT_CREDENTIALS` |
| `openai` | `@langchain/openai` (`ChatOpenAI`) | `LLM_API_KEY` |
| `openai-compatible` | `ChatOpenAI` + `configuration.baseURL` | `LLM_API_KEY`, `LLM_BASE_URL` |

- Выбор: `LLM_PROVIDER` → `LlmRegistry.get(providerId)`, иначе ошибка конфигурации со списком поддерживаемых.
- Модели: `LLM_MODEL` (роль `answer`), `LLM_ROUTER_MODEL` (роль `router`, по умолчанию = `LLM_MODEL`), `LLM_TEMPERATURE`.
- Точка расширения: `anthropic` добавляется одним файлом-фабрикой и записью в реестр — граф не меняется.
- **Почему реестр, а не `initChatModel`:** нужна fail-fast валидация креденшелов на старте и предсказуемый набор поддерживаемых провайдеров; `initChatModel` тянет все интеграции и валидирует лениво.
- **Грабли GigaChat из примера:** `bindTools` форматирует инструменты дважды, поэтому используется `RunnableBinding` с `formatStructuredToolToGigaChat(tools)`; схемы инструментов и structured output объявляются через `zod/v3`, состояние — через `zod` 4 (один пакет `zod@4` экспортирует оба API).

### 5. Реестр MCP-серверов

`@langchain/mcp-adapters` (`MultiServerMCPClient`) собирает конфиг из env, по каждому серверу вызывается `getTools(serverName)`. Далее собственный слой `McpToolRegistry`:

1. фильтрует инструменты по `MCP_<NAME>_ALLOWED_TOOLS`;
2. падает на старте, если allowlist пуст или содержит торговый инструмент;
3. переназывает инструменты в `<server>__<tool>`;
4. оборачивает `invoke` таймаутом 10 с, счётчиком бюджета, маппингом ошибок и трейсингом.

- **Почему адаптер + свой слой:** адаптер снимает работу с транспортами и конвертацию схем, а allowlist, неймспейсинг и лимиты остаются под нашим контролем.
- **Альтернатива:** официальный `@modelcontextprotocol/sdk` напрямую — полный контроль над транспортом, но больше кода на конвертацию JSON Schema → zod и на переподключения.
- **Счёт:** `invest_get_portfolio` требует `accountId`. Если `TINKOFF_ACCOUNT_ID` задан, он подставляется в системный промпт; если нет — allowlist должен включать `invest_list_accounts`, и агент сначала узнаёт счёт.
- **Формат ответов Tinkoff MCP (проверено на живом сервере):** результат приходит объектом `{ instruments: [...] }`; деньги и количества — десятичные **строки** (`"value": "294.55"`), валюта — строчный код (`priceCurrency: "rub"`), у каждого значения своё поле `time` в ISO 8601 UTC. Мапперы разбирают строки строго, сохраняют исходное значение для логов и нормализуют код валюты в верхний регистр; `dataAsOf` прогона — максимальный `time` среди использованных значений.
- **Пункты вместо рублей:** у фьючерсов и части инструментов `priceCurrency` равен `"pt"` — такие значения не подписываются как валюта. В MVP фьючерсов нет, но правило заложено в маппер.
- **Идентификаторы:** `uid` идентифицирует бумагу, `positionUid` — позицию; маппер сохраняет оба и передаёт инструментам то поле, которое требует их схема, чтобы не путать запросы по бумаге и по позиции.
- **MVP allowlist:** `invest_list_accounts`, `invest_get_portfolio`, `invest_get_positions`. Торговые (`invest_create_order`, `invest_create_stoporder`, `invest_deposit_broker_account` и т.п.) отсекаются валидацией.

### 6. Промпты и детерминированный отказ

- Классификатор: системный промпт с определением области «портфель пользователя» и примерами; structured output `{ intent: "portfolio" | "off_topic" }` через модель роли `router`; при ошибке — повторный запрос «ответь одним словом» и разбор ответа (приём из примера).
- Агент: системный промпт задаёт роль («показываю состав портфеля по данным брокера»), требование русского языка, запрет торговых действий, обязательность данных из инструментов, шаблон сводки и дисклеймер.
- `offTopic` — фиксированный текст на русском без вызова LLM: дешевле и детерминированно, отказ не может «уплыть» под влиянием текста вопроса.
- **Почему фиксированный отказ:** убирает лишний вызов модели на каждый нерелевантный вопрос и исключает инъекции через текст вопроса.
- Текст запроса на подтверждение собирается без вызова модели: `question` берётся из правила подтверждения, остальное — детерминированный шаблон `prompts/approval.question.ts` с перечнем действий, поэтому список данных в запросе всегда совпадает с реально планируемыми вызовами.

### 7. Конфигурация через env

Вся настройка — один `.env`, валидация zod на старте, `.env.example` как документация:

```dotenv
# ── Приложение ────────────────────────────────────────────────
PORT=3000
NODE_ENV=development
LOG_LEVEL=info
LOG_QUESTION_TEXT=false

# ── LLM ───────────────────────────────────────────────────────
LLM_PROVIDER=gigachat            # gigachat | openai | openai-compatible
LLM_MODEL=GigaChat-2-Max
LLM_ROUTER_MODEL=GigaChat-2      # по умолчанию = LLM_MODEL
LLM_TEMPERATURE=0.2
LLM_API_KEY=                     # openai / openai-compatible
LLM_BASE_URL=                    # openai-compatible

# GigaChat (только при LLM_PROVIDER=gigachat)
GIGACHAT_CREDENTIALS=
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_AUTH_URL=https://ngw.devices.sberbank.ru:9443/api/v2/oauth

# ── MCP ───────────────────────────────────────────────────────
MCP_SERVERS=tinkoff              # список через запятую: tinkoff,news,...
MCP_TINKOFF_URL=
MCP_TINKOFF_TRANSPORT=http       # http | sse
MCP_TINKOFF_TOKEN=
MCP_TINKOFF_ALLOWED_TOOLS=invest_list_accounts,invest_get_portfolio,invest_get_positions
TINKOFF_ACCOUNT_ID=              # опционально: если пусто, агент узнаёт счёт через MCP

# ── Состояние и подтверждения ─────────────────────────────────
USER_ID=default                  # пространство имён глобального хранилища
STATE_BACKEND=sqlite             # sqlite | memory
STATE_SQLITE_PATH=./data/state.sqlite
STATE_TTL_DAYS=30                # удаление сессий, не обновлявшихся дольше
APPROVAL_TTL_MINUTES=15          # срок жизни запроса на подтверждение
APPROVALS_FILE=                  # опционально: JSON с правилами подтверждений
APPROVAL_UNLISTED=require        # require | allow — политика для действий без правила

# ── Наблюдаемость ─────────────────────────────────────────────
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=invest-analytic
LANGSMITH_TRACE_URL_TEMPLATE=https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}
LANGSMITH_ORG_ID=
```

Правила, которые обеспечивает zod-схема:

1. `MCP_SERVERS` разбирается в список имён; для каждого имени обязателен `MCP_<NAME>_URL`, остальное опционально.
2. Креденшелы проверяются только для выбранного `LLM_PROVIDER` (`superRefine`).
3. `MCP_<NAME>_ALLOWED_TOOLS` обязателен и непуст; торговые имена запрещены.
4. Ошибка валидации перечисляет все проблемные переменные сразу и никогда не печатает значения секретов.
5. `STATE_BACKEND` принимает только `sqlite` или `memory`; при `sqlite` каталог из `STATE_SQLITE_PATH` создаётся на старте.
6. `APPROVAL_TTL_MINUTES` и `STATE_TTL_DAYS` — целые положительные числа (по умолчанию 15 и 30).

- **Почему `MCP_<NAME>_*`, а не единый JSON:** читаемо в `.env`, поддерживается любым деплоем (docker, k8s, secrets), не требует экранирования.
- **Альтернатива:** `MCP_SERVERS_JSON='{"tinkoff":{...}}'` — компактнее, но неудобно править руками и легко сломать кавычками.

### 8. Структура проекта

```
src/
  main.ts
  app.module.ts
  config/{configuration.ts, env.schema.ts}
  api/{agent.controller.ts, health.controller.ts, dto/, filters/http-exception.filter.ts}
  agent/{agent.module.ts, agent-runner.service.ts, approval-flow.service.ts,
         graph/{state.ts, build-graph.ts, routers.ts},
         nodes/{classify.node.ts, off-topic.node.ts, agent.node.ts, approve.node.ts},
         prompts/{classifier.prompt.ts, agent.prompt.ts, off-topic.ts, approval.question.ts},
         approvals/{approval-rules.ts, approval-rules.schema.ts, approval-policy.service.ts}}
  llm/{llm.module.ts, llm-registry.ts, llm-provider.interface.ts,
       providers/{gigachat.provider.ts, openai.provider.ts, openai-compatible.provider.ts}}
  tools/{tools.module.ts, mcp-registry.service.ts, mcp-tool.adapter.ts,
         tool-budget.ts, errors.ts,
         mappers/{portfolio.mapper.ts, instrument.mapper.ts, money.ts}}
  state/{state.module.ts, checkpointer.factory.ts, global-store.service.ts, cleanup.service.ts}
  observability/{observability.module.ts, run-collector.ts, redact.ts, logger.ts}
test/{unit/, e2e/, fixtures/mcp-test-server.ts, fixtures/fake-chat-model.ts}
```

Схема взаимодействия по счастливому пути (подтверждение + чтение портфеля):

```
Клиент              API                 Агент (LangGraph)                 Внешние системы
  │ POST /chat       │                        │                                │
  ├─────────────────>│ requestId, sessionId   │                                │
  │                  ├─ invoke(graph, ───────>│                                │
  │                  │   thread=sessionId)    ├─ classify ───────────────────> │ LLM (router)
  │                  │                        ├─ agent ──────────────────────> │ LLM (answer)
  │                  │                        ├─ approve → interrupt           │
  │                  │                        │  (чекпоинт → SQLite)           │
  │<─ 202 awaiting ──┤<── next = approve ─────┤                                │
  │ POST /chat/approve                        │                                │
  ├─────────────────>├─ Command({resume}) ───>│                                │
  │                  │                        ├─ tools: tinkoff__invest_* ───> │ MCP Tinkoff
  │                  │                        ├─ agent: финальный ответ ──────> │ LLM (answer)
  │<─ 200 completed ─┤<───────────────────────┤                                │
  └                  └────────────────────────┴─ трейс ──────────────────────> │ LangSmith
```

### 9. Наблюдаемость

- LangSmith включается переменными `LANGSMITH_TRACING`, `LANGSMITH_API_KEY`, `LANGSMITH_PROJECT`; дерево LangGraph трассируется автоматически, узлы становятся спанами.
- Адаптер инструментов оборачивается `traceable`, поэтому вызовы MCP попадают в то же дерево с именем `<server>__<tool>`.
- `RunCollector` (callback handler) запоминает `runId` корневого прогона → `traceUrl` по `LANGSMITH_TRACE_URL_TEMPLATE`.
- Логи: JSON-строки с `requestId`, `sessionId`, `intent`, длительностями этапов и именами инструментов; `redact.ts` маскирует токены и заголовки; `LOG_QUESTION_TEXT=false` по умолчанию.
- Сбой экспорта трейса не влияет на ответ (fail-open, предупреждение в логах).

### 10. Ошибки и health

Доменные ошибки: `ConfigError`, `LlmUnavailableError`, `McpUnavailableError`, `McpUnauthorizedError`, `McpRateLimitedError`, `McpInvalidResponseError`, `RunBudgetExceededError`, `ForbiddenToolError`, `NotAwaitingApprovalError`, `ApprovalExpiredError`, `StateStoreError`. Глобальный фильтр приводит их к `{error: {code, message, requestId}}`: `LlmUnavailableError` → `502`, недоступность MCP → `503`, `NotAwaitingApprovalError` → `409`, `ApprovalExpiredError` → `410`, `StateStoreError` и прочие внутренние → `500`.

Health (`@nestjs/terminus`): индикатор LLM проверяет конфигурацию и время последней ошибки (без платного вызова), индикатор на каждый MCP-сервер делает discovery с таймаутом 2 с.

### 11. Тестирование

- `test/fixtures/fake-chat-model.ts` — детерминированная заглушка `BaseChatModel`, возвращающая заранее заданные `tool_calls` и текстовые ответы: граф тестируется без сети и без ключей.
- `test/fixtures/mcp-test-server.ts` — MCP-сервер на `@modelcontextprotocol/sdk` (`server/mcp`) с инструментами-фикстурами портфеля; e2e поднимает его на свободном порту и указывает адрес в `MCP_TINKOFF_URL`.
- Юнит-тесты: env-схема (условная валидация креденшелов, запрет торговых инструментов, пустой allowlist), реестр провайдеров, неймспейсинг и allowlist, роутеры графа, лимиты прогона, переходы `afterAgent` на инструментах, требующих подтверждения, ветка отказа с `ToolMessage` на каждый `tool_call_id`, истечение `APPROVAL_TTL_MINUTES`.
- Правила подтверждений: шаблоны и приоритет первого совпадения, политика `APPROVAL_UNLISTED`, ошибки валидации (дубликат, неизвестный инструмент, торговый инструмент без подтверждения), замена набора через `APPROVALS_FILE`.
- E2E: вопрос о портфеле → `202 awaiting_approval` → подтверждение → `200 completed`; отказ от чтения; повторный вопрос в сессии снова требует подтверждения; пустой портфель, off-topic, недоступный MCP, невалидный ввод.
- Персистентность: тест продолжения сессии и подтверждения после перезапуска приложения на SQLite (инстанс приложения поднимается дважды на одном файле), изоляция пространств имён глобального хранилища.
- Живой smoke-тест против реального MCP-сервера — отдельный npm-скрипт, не в CI.

### 12. Точки расширения (следующие итерации)

- Новый источник (новости, Пульс, макро, налоги, ставка ЦБ): добавить сервер в `MCP_SERVERS` и allowlist, при необходимости — узел графа и абзац в системном промпте.
- Новый LLM-провайдер: файл-фабрика в `src/llm/providers/`, запись в реестр, переменные в zod-схеме и `.env.example`.
- Аналитика по бумаге: новый интент в классификаторе и ветка графа; отчётность выносится в отдельный сервис поверх того же `McpToolRegistry`.
- Новое подтверждаемое действие: правка файла правил (`approval-rules.ts`) или `APPROVALS_FILE`, граф и узлы не меняются.

### 13. Персистентное состояние

- Чекпоинтер: `SqliteSaver` из `@langchain/langgraph-checkpoint-sqlite` (поверх `better-sqlite3`), файл — `STATE_SQLITE_PATH`, таблицы создаются на старте. `STATE_BACKEND=memory` подменяет его на `MemorySaver` для тестов.
- Глобальное хранилище: готового SQLite-стора в LangGraph нет (для продакшена предлагаются `PostgresStore`, `MongoDBStore`, `RedisStore`), поэтому в MVP — `GlobalStore` на том же соединении `better-sqlite3`, таблица `app_global_state(namespace, key, value, updated_at)`. Интерфейс `get`/`put`/`delete`/`search` совпадает с `BaseStore`, поэтому позже он заменяется на `PostgresStore` без правок узлов.
- Состав глобального хранилища: `users/<USER_ID>/settings` с `defaultAccountId` и `schemaVersion`. Данные портфеля туда не попадают — иначе чтение можно было бы обойти подтверждением.
- Ожидающие подтверждения — часть чекпоинта: `thread_id = sessionId`, сведения `interrupt` (время постановки, список действий) читаются через `graph.getState(config)`.
- Очистка: `cleanup.service.ts` при старте удаляет чекпоинты, не обновлявшиеся дольше `STATE_TTL_DAYS`, и просроченные ожидания подтверждения.
- **Почему SQLite, а не Postgres в MVP:** нулевая настройка, один файл, достаточно для одного процесса; переход — замена фабрики чекпоинтера и стора.
- **Альтернатива:** `MemorySaver` — проще, но теряет ожидающие подтверждения при рестарте, что противоречит durable-паузе.

## Risks / Trade-offs

- **Двойное форматирование инструментов в `bindTools` у GigaChat** → `RunnableBinding` с `formatStructuredToolToGigaChat`, как в референсе; тест на прогон с фейковой моделью и реальным списком инструментов.
- **Конфликт zod 3 / zod 4** → состояние на zod 4, схемы инструментов и structured output на `zod/v3`; правило зафиксировано в документации и проверяется сборкой.
- **Галлюцинации чисел в ответе** → системный промпт требует данные только из результатов инструментов; e2e проверяет, что суммы из фикстуры присутствуют в ответе, а выдуманных значений нет.
- **Недоступность MCP на старте** → сервис стартует, health показывает `down`, ответ содержит сообщение о недоступности данных вместо пустой сводки.
- **Ошибка в allowlist** (пустой или торговый инструмент) → fail-fast на старте; тест на обе конфигурации.
- **Память диалога в процессе** → перезапуск теряет историю; для MVP приемлемо, персистентность — следующая итерация с checkpointer в БД.
- **Латентность** (2 вызова модели + MCP) → модель классификации дешёвая и короткая, отказ по off-topic не вызывает LLM, инструменты вызываются только по необходимости.
- **Разные провайдеры по-разному поддерживают функцию вызова инструментов** → фолбэк классификатора на текстовый ответ, smoke-тест на выбранном провайдере.
- **Повторное подтверждение раздражает** → строгий режим выбран осознанно; в запросе подтверждения указано, какие именно данные и по какому счёту будут прочитаны. Политика собрана в одном месте (`approvals.service.ts`), чтобы позже добавить вариант «один раз на пользователя».
- **Побочные эффекты повторяются при resume** → всё, что выполняется до `interrupt`, оборачивается в `task()`; тест на двойное выполнение.
- **Зависшие ожидания подтверждения** → `APPROVAL_TTL_MINUTES` для конкретного ожидания и очистка по `STATE_TTL_DAYS` для брошенных сессий.
- **SQLite и конкуренция записи** → один процесс, режим WAL, последовательные записи; при горизонтальном масштабировании чекпоинтер и стор меняются на Postgres.
- **Рост объёма чекпоинтов** → очистка при старте по `STATE_TTL_DAYS`.
- **Опечатка или пропуск правила оставляет инструмент без подтверждения** → политика по умолчанию `require`, поэтому пропуск правила не открывает чтение; ссылка на несуществующий инструмент валится на старте; файл правил ревьюится отдельно от кода графа.

## Migration Plan

Greenfield, миграций данных нет. Порядок: каркас и env-схема → реестр LLM-провайдеров с заглушкой модели → реестр MCP на тестовом сервере → граф с подтверждением и промптами → HTTP-слой, подтверждение и health → наблюдаемость → персистентность на SQLite → smoke-тест на реальном MCP. Каталог `data/` создаётся на старте и не коммитится; откат — revert коммита и удаление файла состояния.

## Open Questions

- Какой провайдер и модель делать значениями по умолчанию в `.env.example` (`gigachat` или `openai-compatible`): зависит от доступного контура.
- Нужно ли всегда сохранять тексты вопросов в LangSmith или включать `LANGSMITH_HIDE_INPUTS` по умолчанию.
