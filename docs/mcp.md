# MCP-серверы

Сервис подключает MCP-серверы по конфигурации и превращает их инструменты в единый набор для агента. Код графа от числа серверов не зависит.

## Конфигурация

```dotenv
MCP_SERVERS=tinkoff,news

MCP_TINKOFF_URL=https://mcp.example.com/mcp
MCP_TINKOFF_TRANSPORT=http          # http (streamable) | sse
MCP_TINKOFF_TOKEN=<bearer-токен>
MCP_TINKOFF_ALLOWED_TOOLS=invest_list_accounts,invest_get_portfolio,invest_get_positions

MCP_NEWS_URL=https://news.example.com/mcp
MCP_NEWS_TRANSPORT=http
MCP_NEWS_TOKEN=<токен>
MCP_NEWS_ALLOWED_TOOLS=search_news,get_article
```

Для каждого имени `NAME` из `MCP_SERVERS` читаются `MCP_<NAME>_URL` (обязательна), `_TRANSPORT`, `_TOKEN`, `_ALLOWED_TOOLS` (обязательна, непустая).

## Правила

| Правило | Поведение |
|---|---|
| Allowlist | Агенту доступны **только** перечисленные инструменты; остальные отбрасываются |
| Пустой allowlist | Ошибка конфигурации при старте |
| Торговые инструменты | `invest_create_*`, `invest_post_*`, `invest_cancel_*`, `invest_replace_*`, `invest_deposit_*`, `invest_transfer_*`, `invest_sell*`, `invest_buy*` запрещены в allowlist |
| Неймспейсинг | Имя для агента — `<server>__<tool>`, например `tinkoff__invest_get_portfolio` |
| Таймаут | 10 секунд на вызов инструмента |
| Бюджет | 8 вызовов и 30 секунд на прогон (`McpRegistryService.createBudget()`) |
| Недоступный сервер | Старт не падает: сервер помечается `down`, его инструменты не попадают в набор, health отдаёт `503` |

Коды ошибок: `mcp_unavailable`, `mcp_unauthorized`, `mcp_rate_limited`, `mcp_invalid_response`, `forbidden_tool`, `run_budget_exceeded`.

## Как это устроено

```
McpRegistryService (ленивый discovery)
  └─ MultiServerMcpFactory → MultiServerMCPClient (http/sse, Bearer)
       └─ tools/list → фильтр allowlist → wrapTool
            ├─ имя <server>__<tool>
            ├─ таймаут 10 с
            ├─ бюджет вызовов
            ├─ маппинг ошибок в доменные коды
            └─ событие onCall для трейсинга
```

Префикс, который адаптер добавляет сам, отключён (`prefixToolNameWithServerName: false`): неймспейсинг делает наш слой, чтобы правила подтверждений и allowlist работали с исходными именами инструментов.

## Как добавить сервер

1. Добавьте имя в `MCP_SERVERS`.
2. Заполните `MCP_<NAME>_URL/TRANSPORT/TOKEN/ALLOWED_TOOLS`.
3. Перезапустите сервис и проверьте `GET /api/v1/health`: компонент сервера должен быть `up`.
4. Если действия сервера должны требовать подтверждения — добавьте правило в `src/agent/approvals/approval-rules.ts` (имена уже с префиксом, например `news__get_article`).

Код графа, роутеров и узлов не меняется.

## Тестовый сервер для интеграционных тестов

`test/fixtures/mcp-test-server.ts` поднимает настоящий MCP-сервер на `@modelcontextprotocol/sdk` с фикстурами портфеля и списка счетов:

```ts
import { startTestMcpServer } from './test/fixtures/mcp-test-server.js';

const server = await startTestMcpServer();   // HTTP на свободном порту, stateless
// server.url → MCP_TINKOFF_URL
await server.close();
```

Важно: в stateless-режиме транспорт создаётся на каждый POST, иначе второй запрос завершается ошибкой `Error POSTing to endpoint`. Этот пример используется в `test/e2e/mcp-registry.e2e-spec.ts` (`npm run test:e2e`).

Проверка против реального сервера T-Инвест — отдельный шаг (`npm run smoke:mcp`), в CI не входит. Скрипт печатает список инструментов и, если задан `TINKOFF_ACCOUNT_ID`, состав портфеля; успех — код выхода `0`.

Прямое подключение сервера T-Инвест к `@langchain/mcp-adapters` не работает: сервер отдаёт `tools/list` потоком SSE, и адаптер ждёт конца потока до таймаута. Поэтому `smoke:mcp` при таймауте автоматически повторяет проверку через `McpProxyService` — тот же путь, которым ходит приложение (прокси получает JSON и отдаёт его адаптеру). Прямая ветка оставлена, чтобы видеть, если поведение сервера изменится.

Сертификат сервера выпущен УЦ «Министерство цифрового развития, связи и массовых коммуникаций», которого нет в локальном хранилище. Перед запуском:

```bash
node scripts/fetch-mcp-ca.mjs                                   # сохранит цепочку в certs/mcp-chain.pem
NODE_EXTRA_CA_CERTS=./certs/mcp-chain.pem npm run smoke:mcp
```

Приложение проходит эту же проверку через `MCP_<NAME>_TLS_MODE=extra-ca` и `MCP_<NAME>_CA_FILE`.
