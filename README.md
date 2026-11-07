# invest-analytic

Агент-аналитик портфеля **T-Invest**: NestJS 12 + LangGraph 1.x + MCP.

Отвечает на вопросы о вашем портфеле строго по данным брокера, спрашивает подтверждение
перед каждым чтением данных, собирает отчёт по шаблону и объясняет инвестиционные понятия
по собственной базе знаний. Провайдер модели и MCP-серверы задаются только конфигурацией.

- Node.js **>= 22**, ESM (`"type": "module"`)
- Данные — только чтение: торговые операции запрещены на уровне allowlist и правил подтверждений
- Отчёт — markdown-файл: можно скачать (`md`/`json`/`html`) и распечатать

---

## Что умеет

| Что | Пример вопроса | Что получите |
|---|---|---|
| Портфель и счета | «что у меня в портфеле?» | позиции, количество, цена за штуку, стоимость, доходность портфеля и за день |
| Разбор портфеля | «проанализируй мой портфель» | отчёт: цикл и ставка, состав, графики, секторы, концентрация, налоги, экспорт/импорт, пробелы, итог |
| Разбор счёта | «разбери счёт Портфельное инвестирование» | то же по одному счёту, без «шумных» секций |
| Разбор бумаги | «разбери бумагу PLZL», «разбери Сбер» | цена за штуку, динамика 1/7/30/180 дней, график за 90 дней, аналитики, дивиденды, сделки инсайдеров, профиль экспортёра, драйверы сектора, новости бумаги и вывод «за и против»; портфель для этого не читается |
| Вывод по бумаге | «стоит ли покупать Полюс» | детальный разбор: динамика, цель и потенциал аналитиков, дивиденды, инсайдеры, профиль и чувствительность сектора, новости и фон рынка, риски и сценарии (оценка) |
| Аналитика и макро | «какая ключевая ставка ЦБ?», «какие дивиденды у SBER?» | ставка с историей решений, прогнозы, дивидендный календарь |
| Вопрос-решение по бумаге | «стоит ли покупать Полюс», «продавать или держать Сбер» | разбор бумаги с оценкой «за и против», а не одна динамика цены |
| Новости рынка | «какие последние новости в мире инвестиций?» | сводка за сегодня и неделю из деловых лент, без Telegram |
| Объяснение понятий | «что такое дюрация?», «что такое P/E?» | ответ модели-эксперта по теме из базы знаний: определение, механизм, подразделы, ошибки; выжимка темы — запасной вариант |
| Экономика и рынки | «почему ставка ФРС важна?», «будет ли расти рынок?» | разбор с механизмом и сценариями; знания из базы, свежие события — из новостей и MCP |
| Деньги вне бумаг | «стоит ли покупать квартиру в ипотеку?», «гараж или вклад?» | разбор критериев и рисков с уточняющими вопросами; это не посторонняя тема |
| Незнакомая бумага | «что за бумага Хэдхантер?» | тикер и карточка через инструмент `invest_find_instrument`, а не отказ |
| Справка | «что ты умеешь» | карта возможностей и границы сервиса |

Чего не делает: не торгует, не выводит деньги, не даёт индивидуальных инвестиционных
рекомендаций, не отвечает на посторонние темы.

### Что показывает отчёт

| Раздел | Содержимое |
|---|---|
| Состав портфеля | тикер, сектор, доля, цена за штуку, стоимость, спарклайн за 180 дней, изменение, мнение аналитиков; итог и доходность портфеля |
| Экономический цикл | ключевая ставка ЦБ, что она значит для классов активов (модель + база знаний) |
| Фон рынка: новости | до пяти заголовков общей сводки новостей за неделю |
| Разбор по бумагам | цена за штуку, динамика, график, аналитики, дивиденды (размер, дата отсечки и выплаты, регулярность), сделки инсайдеров, облигация (категория, купон, погашение, НКД), профиль «экспортёр / внутренний рынок / импортёр», драйверы сектора, новости бумаги без дублей |
| Оценка бумаг и секторов | динамика, потенциал, новостной фон (модель, темы `reporting` + `multiples`) |
| Вывод по бумаге | разбор «за и против»: факты, цель аналитиков, дивиденды, инсайдеры, профиль сектора, новости и фон рынка, риски и сценарии (модель; только разбор бумаги) |
| Структура и концентрация | разрезы по классу, сектору, валюте, эмитенту; крупнейшая позиция, топ-3 |
| Экспортёры, импортёры и внутренний рынок | доли трёх групп, валютная выручка, влияние курса и ставки |
| Налоговый контекст | удержанные налоги, изменения налогообложения (тема `taxes`) |
| Пробелы в портфеле | классы и секторы ниже порога |
| Итог | диверсификация, тип стратегии, что менять (тема `strategies`) |

Секторы называются по существу: `energy` — «нефть и газ», `utilities` —
«электроэнергетика», `green_energy` — «зелёная энергетика», `it` — «технологии».

### Как это работает

```text
POST /api/v1/agent/chat
        │
   classify (роутер) ── off_topic ─────────────▶ ответ без доступа к данным
        │
        ├─ data_lookup / security_analysis ────▶ agent (LLM + MCP) ─▶ approve ─▶ tools ─▶ ответ
        ├─ portfolio_review ───────────────────▶ plan ─▶ approve ─▶ collect ─▶ report ─▶ отчёт
        ├─ market_news ─────────────────────────▶ сводка новостей (код, без модели)
        ├─ knowledge_question ──────────────────▶ модель-эксперт по теме базы знаний
        └─ agent_help ──────────────────────────▶ справка (код, без модели)
```

- Граф LangGraph с чекпоинтером: прерывание на `approve` переживает перезапуск процесса.
- Данные портфеля читаются только после подтверждения; новости, знания и справка — без
  доступа к счёту.
- Отчёт собирается по шаблону `reports/portfolio-review.yaml`: состав, порядок, пороги и
  темы знаний меняются файлом, без правок кода.
- Числа считает код; модель трактует факты, объясняет механизм и помечает выводы «(оценка)».
- Модели передаётся только набор инструментов под вопрос (`tool-scope.ts`): база плюс
  расширения по теме (облигации, срочный рынок, фонды, графики, риски) — десятки определений
  в контексте путают модель и съедают токены.
- Если модель отвечает отказом показать данные, узел делает один повтор с явной инструкцией
  вызвать инструмент: агент идёт за данными, а не отправляет пользователя в приложение.
- Вопросы по экономике и деньгам (инфляция, ставка, ФРС, бюджет, рубль, ипотека, вклад)
  не относятся к посторонним: знания берутся из базы, недостающие данные — из новостей и MCP.

### Правила разработки агента

Чек-лист и разбор ошибок (по материалам Anthropic + опыт проекта) — в скиллах:

- [`.agents/skills/agent-engineering`](.agents/skills/agent-engineering/SKILL.md) — промпты,
  инструменты, маршрутизация, обработка отказов, evals; главные ошибки и что нельзя делать;
- [`.agents/skills/knowledge-base`](.agents/skills/knowledge-base/SKILL.md) — как писать темы
  базы знаний: формат, глубина, источники, подключение к шаблону.

Коротко:

1. Не отвечать заготовкой: модель синтезирует (факт → механизм → сравнение → следствие).
2. Не отказывать: сначала инструменты (новости, MCP), потом честное «чего не хватает».
3. Не грузить все инструменты: набор под вопрос.
4. Не хардкодить компании и ответы: данные в YAML, эмитент — через инструмент.
5. Любое изменение промпта — с кейсом в eval и живым прогоном.

---

## Требования

| Что | Зачем | Обязательно |
|---|---|---|
| Node.js >= 22 | рантайм (ESM) | да |
| Токен T-Invest API | данные портфеля и рынка через MCP | да |
| Ключ LLM (GigaChat / OpenAI / совместимый) | классификация вопроса и тексты разделов | да |
| Ключ LangSmith | трассировка прогонов | нет |
| Docker + Compose | запуск контейнером | нет |

---

## Быстрый старт

```bash
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
```

Заполните в `.env` минимум три вещи (подробно — в следующем разделе):

```dotenv
MCP_TINKOFF_URL=https://invest-public-api.tinkoff.ru/mcp
MCP_TINKOFF_TOKEN=<токен T-Invest, только чтение>
LLM_PROVIDER=gigachat
LLM_MODEL=GigaChat-2-Max
GIGACHAT_CREDENTIALS=<base64 от client_id:client_secret>
```

T-Invest MCP отдаёт цепочку сертификатов, которой нет в системном хранилище, поэтому один
раз сохраните её и включите режим `extra-ca`:

```bash
node scripts/fetch-mcp-ca.mjs         # создаст certs/mcp-chain.pem
```

```dotenv
MCP_TINKOFF_TLS_MODE=extra-ca
MCP_TINKOFF_CA_FILE=certs/mcp-chain.pem
```

Соберите и запустите:

```bash
npm run build
npm start                 # http://localhost:3000/api/v1
```

Проверка, что всё поднялось:

```bash
curl -s http://localhost:3000/api/v1/health
# {"status":"ok","info":{"llm":{"status":"up"},"mcp:tinkoff":{"status":"up"}}}
```

Первый вопрос (сценарий «вопрос → подтверждение → ответ»):

```bash
curl -s -X POST http://localhost:3000/api/v1/agent/chat \
  -H 'content-type: application/json' \
  -d '{"message":"что у меня в портфеле?"}'
# 202 {"status":"awaiting_approval","sessionId":"<uuid>","approval":{...}}

curl -s -X POST http://localhost:3000/api/v1/agent/chat/approve \
  -H 'content-type: application/json' \
  -d '{"sessionId":"<uuid>","approved":true}'
# 200 {"status":"completed","intent":"data_lookup","answer":"..."}
```

---

## Где взять токены и куда их положить

Все секреты живут только в `.env` (файл в `.gitignore`); в логах и ошибках значения
маскируются.

### 1. T-Invest API (данные брокера)

**Где взять**

1. T-Invest / Т-Банк Инвестиции → **Настройки** → **Токены для API**
   (веб: `https://www.tinkoff.ru/invest/settings/api/`).
2. Создайте токен и выдайте **только права чтения** — торговые и платёжные методы
   сервису не нужны и запрещены allowlist-ом.
3. Скопируйте токен: он показывается один раз.

**Куда положить**

```dotenv
MCP_SERVERS=tinkoff
MCP_TINKOFF_URL=https://invest-public-api.tinkoff.ru/mcp   # или ...tbank.ru/mcp
MCP_TINKOFF_TRANSPORT=http
MCP_TINKOFF_TOKEN=<токен из кабинета>
# Необязательно: счёт по умолчанию. Если пусто — агент узнает счета через MCP
TINKOFF_ACCOUNT_ID=
```

`MCP_TINKOFF_ALLOWED_TOOLS` в `.env.example` уже содержит полный набор read-only методов
(портфель, позиции, операции, справочники, свечи, прогнозы, дивиденды, события облигаций,
новости). Торговые методы запрещены и схемой (`FORBIDDEN_TOOL_PATTERNS`), и правилами
подтверждений.

**TLS.** Если без него MCP не подключается (`SELF_SIGNED_CERT_IN_CHAIN`,
`unable to verify the first certificate`):

```bash
node scripts/fetch-mcp-ca.mjs                    # URL из MCP_TINKOFF_URL, файл certs/mcp-chain.pem
node scripts/fetch-mcp-ca.mjs <url> certs/ca.pem # или явно
```

```dotenv
MCP_TINKOFF_TLS_MODE=extra-ca
MCP_TINKOFF_CA_FILE=certs/mcp-chain.pem
```

**Проверка**: `npm run smoke:mcp` — подключение к MCP, список инструментов и пример
портфеля. Каталог `certs/` в `.gitignore`, сертификат не коммитится.

### 2. LLM (обязательно один из провайдеров)

**GigaChat**

- Где взять: кабинет GigaChat API на `developers.sber.ru` → проект → **Client ID** и
  **Client Secret**.
- Куда положить: `base64(client_id:client_secret)` одной строкой.

```dotenv
LLM_PROVIDER=gigachat
LLM_MODEL=GigaChat-2-Max
LLM_ROUTER_MODEL=GigaChat-2
GIGACHAT_CREDENTIALS=<base64 client_id:client_secret>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_STREAMING=false
```

**OpenAI**

- Где взять: `platform.openai.com` → API keys → Create new secret key.

```dotenv
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
LLM_API_KEY=<ключ>
```

**OpenAI-совместимый** (OpenRouter, локальный vLLM/Ollama с OpenAI API):

```dotenv
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://openrouter.ai/api/v1
LLM_API_KEY=<ключ>
LLM_MODEL=<имя модели>
```

**Проверка**: `GET /api/v1/health` → `llm: up`. Креденшелы проверяются только для
выбранного провайдера — остальные переменные можно не заполнять.

### 3. LangSmith (необязательно)

- Где взять: `smith.langchain.com` → Settings → API Keys.
- Зачем: трассировка прогонов (узлы графа, вызовы инструментов, время) и `traceUrl`
  в каждом ответе.

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<ключ>
LANGSMITH_PROJECT=invest-analytic
LANGSMITH_ORG_ID=<id организации>     # нужен для ссылки на трейс
LANGSMITH_HIDE_INPUTS=false
```

### Сводная таблица «переменная → где взять»

| Переменная | Где взять |
|---|---|
| `MCP_TINKOFF_TOKEN` | T-Invest → Настройки → Токены для API (read-only) |
| `MCP_TINKOFF_URL` | `https://invest-public-api.tinkoff.ru/mcp` |
| `MCP_TINKOFF_CA_FILE` | `node scripts/fetch-mcp-ca.mjs` → `certs/mcp-chain.pem` |
| `GIGACHAT_CREDENTIALS` | developers.sber.ru → GigaChat API → base64(client_id:client_secret) |
| `LLM_API_KEY` / `LLM_BASE_URL` | platform.openai.com или ваш OpenAI-совместимый API |
| `LANGSMITH_API_KEY` | smith.langchain.com → Settings → API Keys |
| `TINKOFF_ACCOUNT_ID` | номер счёта в приложении (необязательно) |

Проверить ключи до запуска сервиса:

```bash
npm run smoke:mcp          # токен T-Invest и подключение к MCP
```


---

## Запуск

### Локально

```bash
npm install
npm run build
npm start                 # node dist/main.js → http://localhost:3000/api/v1
```

Разработка с пересборкой (два терминала):

```bash
npm run start:dev         # tsc -w: пересобирает dist
npm start                 # второй терминал: запускает сервис
```

### Docker

```bash
node scripts/fetch-mcp-ca.mjs      # один раз: сертификат T-Invest в certs/
docker compose up -d --build
docker compose ps                  # ждём healthy
curl -s http://localhost:3000/api/v1/health
docker compose logs -f
docker compose down
```

Что важно в `docker-compose.yml`:

- `env_file: .env` — все переменные из вашего `.env`;
- `MCP_TINKOFF_URL`, `MCP_TINKOFF_TLS_MODE=extra-ca`, `MCP_TINKOFF_CA_FILE=/app/certs/mcp-chain.pem`
  заданы явно, чтобы контейнер не зависел от локальных правок;
- тома: `./data` (знания, профили, справочники), `./.state` (состояние и отчёты),
  `./certs` (CA, только чтение);
- healthcheck бьёт в `/api/v1/health`.

### LangGraph Studio (отладка графа)

```bash
npm run studio            # собирает и поднимает dev-сервер на 127.0.0.1:2024
npm run studio:check      # проверяет, что граф виден и отвечает
npm run studio:open       # открывает Studio в браузере
```

Привязка к `127.0.0.1` обязательна: по умолчанию CLI слушает IPv6 `::1`, и браузер не
достучится до API.

**Как подтвердить действие в Studio.** Панель `Interrupts` → в поле значения введите
`true` (или `{"approved": true}`) и нажмите `Resume`. Пустое поле не сработает: Studio
отправляет пустую строку, и dev-сервер LangGraph отвечает
`EmptyInputError: Received empty Command input` — до узла `approve` дело не доходит.
Отказ — `{"approved": false}`. Подробности в `docs/approvals.md`.

### Выгрузка готового отчёта

```bash
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=md"    # по умолчанию
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=json"
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=html"  # для печати/PDF
```

---

## Логи, прогоны и трассировка

### Логи приложения

Пишутся структурным JSON (pino) в stdout — при `npm start` это консоль, при запуске
в фоне (`Start-Process`, systemd, Docker) — файл, который вы указали.

| Что смотреть | Где |
|---|---|
| Уровень логов | `LOG_LEVEL=debug|info|warn|error` |
| Текст вопросов пользователя | `LOG_QUESTION_TEXT=true` (по умолчанию скрыт) |
| Один прогон в логах | общие поля `runId`, `requestId`, `sessionId` во всех строках |
| Ошибки LLM/MCP | строки `level=error`, коды `mcp_unavailable`, `mcp_unauthorized`, `mcp_rate_limited` |
| Старт и конец прогона | `msg: "Прогон начат"` / `"Прогон завершён"` с `intent`, `partial`, `durationMs` |

Секреты в логах маскируются; полный текст вопроса включается только флагом.

Пример фонового запуска с логами в файл (Windows PowerShell):

```powershell
$p = Start-Process node -ArgumentList 'dist/main.js' -PassThru `
  -RedirectStandardOutput svc.log -RedirectStandardError svc.err.log
$p.Id | Set-Content svc.pid
Get-Content svc.log -Tail 50 -Wait
```

### Журнал прогона и replay

Каждый прогон пишет JSONL в `.state/runs/<runId>.jsonl` (`STATE_RUNS_DIR`):
вопрос, решение маршрутизатора, вызовы инструментов, ответ, покрытие источников.
`runId` есть в каждом ответе API и в логах.

```bash
npm run replay -- <runId>        # текстовый транскрипт прогона, без сети
```

### LangSmith (трассировка)

Включается переменными; без ключа сервис работает как обычно, `traceUrl` в ответе — `—`.

```dotenv
LANGSMITH_TRACING=true
LANGSMITH_API_KEY=<ключ smith.langchain.com>
LANGSMITH_PROJECT=invest-analytic
LANGSMITH_ORG_ID=<id организации>       # нужен для ссылки на трейс
LANGSMITH_HIDE_INPUTS=false             # true — не отправлять тексты в трейсы
LANGSMITH_TRACE_URL_TEMPLATE=https://smith.langchain.com/o/{orgId}/projects/p/{project}/r/{runId}
```

Где смотреть:

1. Каждый ответ API содержит `traceUrl` — прямая ссылка на прогон в LangSmith.
2. `smith.langchain.com` → проект `LANGSMITH_PROJECT` → раздел Runs: видны узлы графа,
   вызовы инструментов, время и ошибки.
3. Найти прогон по `runId`: `npm run trace -- <runId>` — скрипт печатает ссылку
   (ищет по метаданным, если SDK создал собственный root-id).
4. Список последних прогонов: `node scripts/ls-runs.mjs`.

Если трейсы не появляются: проверьте `LANGSMITH_TRACING=true`, ключ и что проект
существует; при `403` в логах — ключ без прав на запись в этот проект.

---

## API

| Метод | Путь | Ответ |
|---|---|---|
| `POST` | `/api/v1/agent/chat` | `200` — ответ; `202` — нужно подтверждение |
| `POST` | `/api/v1/agent/chat/stream` | поток событий (SSE): этапы прогона и итоговый результат |
| `POST` | `/api/v1/agent/chat/approve` | `approved: true\|false`; `200`/`202` |
| `POST` | `/api/v1/agent/runs/:runId/cancel` | `cancelled: true\|false` (идемпотентно) |
| `GET` | `/api/v1/health` | состояние LLM и каждого MCP-сервера |
| `GET` | `/api/v1/reports/:reportId?format=md\|json\|html` | готовый отчёт |

Полные примеры, значения `intent` и коды ошибок — в [`docs/api.md`](docs/api.md).

Что стоит знать заранее:

- **Подтверждение** требуется на каждое чтение данных; внутри одного разбора весь план
  подтверждается одним запросом (`actions` в ответе `202`).
- **Дедлайн** прогона — `RUN_DEADLINE_MS` (240 с). Клиентский таймаут должен быть больше:
  разбор делает отдельный вызов модели на раздел.
- **Состояние** сессий и отчётов — SQLite (`.state/state.sqlite`); прерывание на
  подтверждении переживает перезапуск процесса.


---

## Что где лежит

```text
src/
  main.ts                 точка входа: Nest, префикс /api/v1, порт
  app.module.ts           сборка feature-модулей
  tools.module.ts         композиция тулов: единственное место регистрации
  agent/                  граф и узлы
    agent-runner.service.ts   run / stream / cancel / approve / отчёт
    graph/                    state, routers, build-graph
    subgraphs/review/         план → подтверждение → сбор → отчёт одним узлом
    nodes/<node>/             узел и промпт рядом (classify, agent, news, help, knowledge)
    routing/                  guard → правила → модель → безопасный вариант
    planning/                 каталог возможностей и планировщик с фолбэком
    results/                  типизированный результат узла (report / analysis / facts)
    services/                 ответ: отказ модели, факты вместо разбора, готовый отчёт
    runner/                   события прогона, журнал, лимиты
    approvals/                правила подтверждений
    scope.ts                  «портфель / счёт / бумага» по вопросу
  platform/               сквозная инфраструктура: домен сюда не импортируется
    config/                   zod-схема env, типизированный конфиг, fail-fast
    state/                    чекпоинтер, хранилище отчётов, глобальные настройки, очистка
    llm/                      реестр провайдеров, bind-tools, structured output
    observability/            структурные логи, маскирование секретов
    logging/                  pino, контекст прогона, маскирование секретов
    runs/                     журнал прогонов (JSONL), воспроизведение, метрики
    http/                     шлюз внешних запросов: таймаут, повторы, кэш
  shared/                 чистые утилиты: money.ts, json.ts, parsing/ (mappers, yaml, feed, html)
  capabilities/           вертикальные срезы — одна папка на сущность
    news/                     домен (CanonicalItem, политика), конвейер, источники, tools
    instruments/              фасады бумаг, динамика цены
    knowledge/                база знаний: репозиторий, отбор тем, формат ответа, тул
    market/                   ставка ЦБ, цены металлов, их тулы
    portfolio/                счета, снимок портфеля, налоговый дозор
    reports/                  отчёт: шаблон, движок фактов, провайдеры, рендер, сбор фактов
  transports/
    http/                     controllers (agent, health, reports), dto, filters
    mcp/                      реестр, прокси, адаптер, схемы, бюджет
  eval/                   кейсы, грейдеры, агрегаты, судья по рубрике
```

Куда смотреть по задаче:

| Задача | Файл |
|---|---|
| Добавить инструмент для модели | `src/capabilities/<domain>/tools/<tool>/` + `src/transports/mcp/local-tools.ts` |
| Подключить MCP-сервер | `.env` (`MCP_SERVERS`, `MCP_<NAME>_*`), `docs/mcp.md` |
| Добавить источник новостей | `src/capabilities/news/sources/` + `NEWS_SOURCES` |
| Добавить секцию отчёта | `reports/portfolio-review.yaml` + провайдер в `src/capabilities/reports/providers/` |
| Изменить порядок или пороги отчёта | только `reports/portfolio-review.yaml` |
| Добавить тему знаний | `data/knowledge/NN-<id>.yaml`, формат — `docs/knowledge.md` и скилл `knowledge-base` |
| Поправить драйверы сектора или профиль компании | `data/company-profiles.yaml` |
| Ограничить набор инструментов под вопрос | `src/agent/nodes/agent/tool-scope.ts` |
| Сменить модель или провайдера | `LLM_PROVIDER` + `docs/llm-providers.md` |
| Разобраться с подтверждениями | `src/agent/approvals/`, `docs/approvals.md` |
| Понять правила разработки агента | `.agents/skills/agent-engineering/SKILL.md` |
| Инструменты под текущий вопрос | `src/agent/nodes/agent/tool-scope.ts` |
| Поиск эмитента по названию | `src/agent/nodes/agent/discovery.ts` |
| Журнал прогона | `.state/runs/<runId>.jsonl` (+ `npm run replay -- <runId>`) |
| Живые проверки вопросов | `node scripts/ask.mjs "вопрос" --full --approve` |

Ещё несколько мест, которые часто ищут:

- `data/knowledge/` — 44 темы базы знаний (конспекты с источниками), формат в `docs/knowledge.md`;
- `reports/portfolio-review.yaml` — структура отчёта; `reports/prompts/interpretation.md` — промпт разделов;
- `data/` — алиасы тикеров, профили компаний, планы ЦБ, налоговые термины, дополнительные ленты;
- `scripts/` — `ask.mjs` (вопрос в сессии), `replay-run.mjs`, `trace-report.mjs`, `ls-runs.mjs`, `eval*.mjs`, `fetch-mcp-ca.mjs`;
- `.agents/skills/` — правила разработки агента и базы знаний для будущих изменений;
- `certs/` — цепочка сертификатов MCP (не версионируется); `.state/` — SQLite, сессии, отчёты, журналы.

Что **не** версионируется: `.env`, `.state/`, `certs/`, `dist/`, `node_modules/`.
`data/` версионируется: это справочники и знания, а не состояние.


---

## Инструменты агента

Модели не отдаются все инструменты сразу: `tool-scope.ts` собирает набор под вопрос
(база + расширения по теме).

### Локальные инструменты (приложение)

| Инструмент | Что делает | Когда используется |
|---|---|---|
| `instruments__find` | поиск бумаги по тикеру или названию | бумага названа словами, новый эмитент |
| `instruments__prices` | текущая цена и изменение за день | «сколько стоит», «что с ценой» |
| `instruments__candles` | свечи за период | графики, динамика |
| `instruments__forecast` | цель и мнение аналитиков | «стоит ли», «перспективы» |
| `instruments__dividends` | дивиденды, доходность, даты отсечки | дивидендные вопросы |
| `instruments__meta` | карточка: сектор, тип, купон, погашение, НКД | «что за бумага», облигации |
| `news__search` | публикации по бумаге или общей повестке, факторы | причины движения, «что нового» |
| `market__factors` | числа по рынку: нефть, курсы, ставка ЦБ | аргументы к причинам |
| `market__price_dynamics` | готовый отчёт «динамика цены за N дней» | «почему упал», «что с бумагой» |
| `market__news_digest` | сводка новостей по периодам | общая повестка |
| `macro__key_rate` | ключевая ставка и история решений | макро-вопросы |
| `market__tax_watch` | налоговые изменения | налоговый контекст |
| `portfolio__snapshot` | сводка по всем открытым счетам | «что у меня в портфеле» |
| `portfolio__review` | сбор данных под разбор портфеля | «проанализируй портфель» |
| `security__brief` | сбор данных под разбор бумаги | «разбери бумагу» |
| `knowledge__explain` | ответ по теме из базы знаний | «что такое …» |

### MCP Тинькофф (данные брокера)

Разрешены только read-only инструменты (`MCP_TINKOFF_ALLOWED_TOOLS`, 54 штуки):

| Группа | Инструменты | Что дают |
|---|---|---|
| Счета и доступ | `invest_list_accounts`, `invest_list_broker_accounts`, `invest_get_user_info` | список счетов, тариф, статус |
| Портфель | `invest_get_portfolio`, `invest_get_positions`, `invest_get_operations` | состав, количество, стоимость, доходность, операции и налоги |
| Маржа и заявки | `invest_get_broker_account_margin`, `invest_get_broker_account_values`, `invest_get_orders`, `invest_get_order_state`, `invest_get_stoporders`, `invest_get_blocked_guarantee` | обеспечение, активные заявки (чтение) |
| Справочники | `invest_find_instrument`, `invest_list_shares/bonds/etfs/futures/options/dfas`, `invest_get_share/bond/etf/future/option/dfa/currency`, `invest_get_asset`, `invest_get_brand` | поиск, карточки, сектор |
| Рынок | `invest_get_candles`, `invest_get_last_trades`, `invest_get_market_values`, `invest_get_orderbook`, `invest_get_tech_analysis`, `invest_get_trading_schedule`, `invest_get_trading_statuses` | цены, свечи, стакан, тех. анализ, расписание |
| Аналитика | `invest_get_forecast`, `invest_list_consensus_forecasts`, `invest_get_asset_fundamentals`, `invest_get_insider_deals`, `invest_get_instrument_reports`, `invest_list_signals`, `invest_list_strategies`, `invest_get_risk_rates` | цели аналитиков, консенсус, инсайдеры, отчётность, сигналы |
| Облигации | `invest_get_bond_events`, `invest_get_bond_accrued`, `invest_list_bonds` | купоны, оферты, НКД |
| Новости | `invest_get_news` | публикации по тикеру |

### Расширения по теме вопроса

| Тема в вопросе | Что добавляется |
|---|---|
| облигации, купон, оферта | `invest_list_bonds`, `invest_get_bond_events`, `invest_get_bond_accrued` |
| фьючерсы, опционы, срочный рынок | `invest_list_futures`, `invest_get_future`, `invest_list_options`, `invest_get_option` |
| фонды, ETF | `invest_list_etfs`, `invest_get_etf` |
| ЦФА, цифровые активы | `invest_list_dfas`, `invest_get_dfa` |
| валюта, курс | `invest_get_currency`, `invest_list_currencies` |
| график, свечи, тех. анализ | `invest_get_candles`, `invest_get_last_trades`, `invest_get_tech_analysis` |
| риск, маржа, плечо | `invest_get_risk_rates`, `invest_get_broker_account_margin` |
| заявки, стопы | `invest_get_orders`, `invest_get_order_state`, `invest_get_stoporders` |
| каталог бумаг | `invest_list_shares/bonds/etfs/assets/brands` |

Если нужной операции нет в наборе, агент использует фасады `instruments__*`.

---

## Новости: откуда берутся и как добавить источник

Новости собираются из деловых RSS и HTML-страниц; Telegram не используется.
Включение — `SOURCES` (данные) и `NEWS_SOURCES` (ленты).

| id | Что даёт | Адрес | Формат |
|---|---|---|---|
| `tinkoff` | новости по тикерам, портфель, аналитика | T-Invest MCP | MCP (JSON) |
| `cbr` | ключевая ставка и история | `cbr.ru/DailyInfoWebServ` | SOAP → XML |
| `interfax` | общие новости | `interfax.ru/rss.asp` | RSS |
| `rbc` | экономика и рынки | `rssexport.rbc.ru/…/full.rss` | RSS |
| `smartlab` | мнения сообщества | `smart-lab.ru/rss/` | RSS |
| `smartlab_tag` | разборы по тикеру | `smart-lab.ru/rss/tag/<TICKER>` | RSS |
| `rbc_quote` | новости рынка с тикерами | `rbc.ru/quote` | HTML + `__NEXT_DATA__` |
| `tbank_research` | идеи Т-Инвестиций | `tbank.ru/invest/research` | HTML + SSR |
| `vedomosti` | деловые новости | `vedomosti.ru/rss/news` | RSS |
| `kommersant` | финансы | `kommersant.ru/RSS/section-finance.xml` | RSS |
| `tass` | экономика | `tass.ru/rss/v2.xml?category=ekonomika` | RSS |
| `finam` | компании и рынок | `finam.ru/analysis/conews/rsspoint/` | RSS |
| `news_extra` | ваши дополнительные ленты | `data/news-sources.yaml` | RSS |

### Как добавить источник

1. Добавьте запись в `data/news-sources.yaml` (файл указан в `NEWS_EXTRA_FEEDS_FILE`):

   ```yaml
   feeds:
     - id: my_feed
       url: https://example.com/rss
       format: rss          # rss | html
       topics: [news]       # news | macro | tax
   ```

2. Включите источник: `SOURCES=...,news_extra` и `NEWS_SOURCES=...,news_extra`.
3. Перезапустите сервис — код менять не нужно.
4. Для ленты по конкретному тикеру используйте источник с фильтром по названию
   (заголовки проверяются по алиасам) или `smartlab_tag`.

Подробности формата, фильтров (дайджесты, офтоп, омонимы компаний) и разбора HTML —
в [`docs/sources.md`](docs/sources.md).

---

## Что берётся через Тинькофф

| Данные | Источник (MCP) | Где видно в ответе |
|---|---|---|
| Состав портфеля, количество, стоимость | `invest_get_portfolio`, `invest_get_positions` | таблица портфеля, разбор |
| Доходность портфеля и за день | `invest_get_portfolio` (`expectedYield`, `dailyYieldRelative`) | итог таблицы |
| Операции и удержанные налоги | `invest_get_operations` | налоговый контекст |
| Цена и изменение | `invest_get_market_values` | карточка бумаги |
| История цен | `invest_get_candles` | график, динамика 1/7/30/180 |
| Дивиденды | `invest_get_share_dividends` | дивидендный блок |
| Прогноз и цель аналитиков | `invest_get_forecast`, `invest_list_consensus_forecasts` | «аналитики», вывод |
| Фундаментал | `invest_get_asset_fundamentals` | часто пусто — честно «данных нет» |
| Инсайдеры | `invest_get_insider_deals` | блок «инсайдеры» |
| Облигации | `invest_get_bond`, `invest_get_bond_events`, `invest_get_bond_accrued` | купон, оферта, НКД |
| Новости по тикеру | `invest_get_news` | публикации по бумаге |
| Сектор и тип бумаги | `invest_get_share` → `invest_get_asset` → `invest_get_brand` | «сектор: финансы» |

Ключевая ставка ЦБ берётся не у брокера, а из ЦБ (`SOURCES=cbr`); новости — из лент
и брокера; знания — из `data/knowledge`.

---

## Конфигурация

Все переменные читаются один раз при старте и проверяются zod-схемой
(`src/platform/config/env/`). Некорректная конфигурация — падение с перечнем **всех** проблемных
переменных; значения секретов в вывод не попадают. Полный список — в
[`.env.example`](.env.example).

### Минимальный `.env` для запуска

```dotenv
# 1. Брокер: данные портфеля и рынка
MCP_SERVERS=tinkoff
MCP_TINKOFF_URL=https://invest-public-api.tinkoff.ru/mcp
MCP_TINKOFF_TOKEN=<токен T-Invest, только чтение>
MCP_TINKOFF_TLS_MODE=extra-ca
MCP_TINKOFF_CA_FILE=certs/mcp-chain.pem
# allowlist можно не заполнять: в .env.example лежит полный read-only каталог
MCP_TINKOFF_ALLOWED_TOOLS=<см. .env.example>

# 2. Модель (пример GigaChat; для OpenAI — LLM_PROVIDER=openai)
LLM_PROVIDER=gigachat
LLM_MODEL=GigaChat-2-Max
GIGACHAT_CREDENTIALS=<base64 от client_id:client_secret>
GIGACHAT_SCOPE=GIGACHAT_API_PERS
GIGACHAT_STREAMING=false

# 3. Необязательно: трассировка
LANGSMITH_TRACING=false
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=invest-analytic
```

Всё остальное имеет рабочие значения по умолчанию: шаблон отчёта, каталог знаний,
источники новостей, лимиты прогона, SQLite-состояние.

### Обязательные и необязательные переменные

| Переменная | Обязательна | Откуда взять |
|---|---|---|
| `MCP_TINKOFF_URL` | да | фиксированный адрес MCP-сервера брокера |
| `MCP_TINKOFF_TOKEN` | да | T-Invest → Настройки → Токены для API (read-only) |
| `MCP_TINKOFF_ALLOWED_TOOLS` | да | список из `.env.example` (read-only каталог) |
| `MCP_TINKOFF_CA_FILE` | при `extra-ca` | `node scripts/fetch-mcp-ca.mjs` |
| `LLM_PROVIDER`, `LLM_MODEL` | да | `gigachat`, `openai` или `openai-compatible` |
| `GIGACHAT_CREDENTIALS` | для GigaChat | developers.sber.ru → GigaChat API → base64(client_id:client_secret) |
| `LLM_API_KEY` | для OpenAI | platform.openai.com → API keys |
| `LLM_BASE_URL` | для openai-compatible | адрес вашего шлюза |
| `LANGSMITH_*` | нет | smith.langchain.com → Settings → API Keys |
| `TINKOFF_ACCOUNT_ID` | нет | номер счёта; если пусто — агент найдёт сам |

### Ключевые группы

| Группа | Переменные | Зачем |
|---|---|---|
| Приложение | `NODE_ENV`, `PORT`, `LOG_LEVEL`, `LOG_QUESTION_TEXT`, `USER_ID` | порт, логи, пространство имён хранилища |
| LLM | `LLM_PROVIDER`, `LLM_MODEL`, `LLM_ROUTER_MODEL`, `LLM_TEMPERATURE`, `LLM_API_KEY`, `LLM_BASE_URL`, `GIGACHAT_*` | провайдер и модели |
| MCP | `MCP_SERVERS`, `MCP_<NAME>_URL/TRANSPORT/TOKEN/ALLOWED_TOOLS/TLS_MODE/CA_FILE`, `TINKOFF_ACCOUNT_ID` | подключение к брокеру |
| Прогон | `RUN_TOOL_MAX_CALLS`, `RUN_DEADLINE_MS`, `RUN_PARALLELISM`, `REVIEW_MAX_INSTRUMENTS`, `MCP_TOOL_TIMEOUT_MS` | лимиты и таймауты |
| Отчёт | `REPORT_TEMPLATE_FILE`, `REPORT_INTERPRETATION_PROMPT_FILE`, `REVIEW_ENABLED` | шаблон, промпт, ветка разбора |
| Знания | `KNOWLEDGE_ENABLED`, `KNOWLEDGE_DIR`, `KNOWLEDGE_FILE`, `KNOWLEDGE_MAX_CHARS` | каталог тем и объём блока |
| Источники | `SOURCES`, `NEWS_SOURCES`, `NEWS_SCAN_PAGES`, `NEWS_DIGEST_MAX_ITEMS`, `NEWS_FEED_*`, `KEY_RATE_*`, `TAX_KEYWORDS_FILE`, `TICKER_ALIASES_FILE`, `COMPANY_PROFILES_FILE` | новости, ставка, налоги, профили |
| Состояние | `STATE_BACKEND`, `STATE_SQLITE_PATH`, `STATE_TTL_DAYS`, `APPROVAL_TTL_MINUTES`, `APPROVAL_UNLISTED`, `APPROVALS_FILE` | SQLite, TTL, политика подтверждений |
| Наблюдаемость | `LANGSMITH_*` | трассировка и `traceUrl` |

Полезные ручки:

- `REVIEW_ENABLED=false` — откат к поведению без глубокого разбора;
- `NEWS_FEED_ENABLED=false` — отключить ветку сводки новостей;
- `KNOWLEDGE_ENABLED=false` — отключить базу знаний и справочные ответы;
- `AGENT_HELP_ENABLED=false` — отключить ветку «что ты умеешь»;
- `SOURCES` / `NEWS_SOURCES` — включить или выключить конкретные источники
  (`tinkoff`, `cbr`, `interfax`, `rbc`, `smartlab`, `smartlab_tag`, `rbc_quote`,
  `tbank_research`, `vedomosti`, `kommersant`, `tass`, `finam`);
- `NEWS_FEED_PERIODS=1,7` — окна сводки в днях (по возрастанию);
- `COMPANY_PROFILES_FILE` — файл драйверов секторов и профилей компаний.

### Проверки и тесты

```bash
npm run build             # tsc, строгая проверка типов
npm run lint              # eslint (src + test)
npm test                  # unit-тесты: домен, узлы, источники, фасады, контракты
npm run test:e2e          # e2e: граф, HTTP, MCP, рестарт состояния
npm run eval              # оценка качества агента на наборе кейсов (офлайн)
npm run replay -- <runId> # транскрипт прогона из журнала (без сети)
npm run smoke:mcp         # живое подключение к T-Invest MCP (нужен .env)
npm run studio:check      # граф виден в LangGraph Studio
```

Как устроены оценка и отладка:

- [`docs/evals.md`](docs/evals.md) — кейсы, грейдеры, `pass@k`/`pass^k`, режимы `offline`/`live`/`judge`;
- [`docs/observability.md`](docs/observability.md) — JSON-логи, `runId`, журнал прогона, метрики;
- [`docs/structure.md`](docs/structure.md) — куда класть новую ноду, тул, источник, секцию.


---

## Ограничения

- Только чтение: торговые и платёжные операции MCP запрещены allowlist-ом и правилами
  подтверждений.
- Одна сессия = один `USER_ID`: мультипользовательской авторизации нет.
- Нет UI и стриминга: ответ приходит одним JSON после подтверждения; дедлайн —
  `RUN_DEADLINE_MS`.
- Провайдер фактов по бумаге не отдаёт среднюю цену покупки, поэтому доходность считается
  по портфелю (`expectedYield`, `dailyYieldRelative`), а не по каждой позиции.
- Календарь отчётности (`invest_get_instrument_reports`) у брокера отдаёт ответ, не
  проходящий его собственную валидацию, поэтому «дата следующего отчёта» не выводится;
  дивидендный календарь работает.
- Фундаментальные мультипликаторы (P/E, P/B, EV/EBITDA) брокер через MCP не отдаёт:
  `invest_get_asset_fundamentals` возвращает пустой список. В карточке — цена, динамика,
  прогноз аналитиков, дивиденды и сделки инсайдеров, а принципы расчёта мультипликаторов
  модель получает в справочном блоке промпта: считать их нужно по отчётности эмитента.
- Ставка купона облигации оценивается по накопленному доходу между выплатами (точного
  поля в карточке нет) и помечается «(оценка)».
- Инфляции, макрокалендаря и обзоров инвест-домов в источниках нет: выводы на принципах
  помечаются «(оценка)»; агент объясняет механизм, но не назовёт «инфляция 6,95 %» из
  свежих данных — таких данных в MCP нет.
- Веб-поиска нет: нехватку знаний агент закрывает новостными лентами и MCP, а не интернетом.
- «Нет данных» в брифинге — это отсутствие факта: модель не выводит из него оценку
  («долг — нет данных» не значит «низкий долг»).
- Посторонние темы (погода, политика, медицина) по-прежнему вне компетенции: отказ здесь
  осознанный, чтобы агент не выдумывал.
- Сравнение «лидер/аутсайдер» строится по данным брифинга, а не по медиане сектора:
  инструмента сравнения с конкурентами в MCP нет.
- Поиск эмитента по названию зависит от каталога брокера: «Сегежа» находится (SGZH),
  а «ВУШ Холдинг» по слову «ВУШ» брокер отдаёт только облигациями — тогда агент честно
  пишет, что бумага не найдена, и просит тикер, а не выдумывает данные.
- Если брокер не отдал сектор бумаги, в разрезах честно пишется «сектор не определён»
  с долей такого портфеля.
- Telegram не используется: новости — деловые RSS и HTML-страницы брокеров.
- Вопрос про бумагу не читает портфель: ответ содержит только её карточку и оценку сектора;
  новости брокера по тикеру фильтруются по упоминанию бумаги, а график и диапазон цен
  ограничены последними 90 днями.

---

## Если что-то не работает

| Симптом | Причина и решение |
|---|---|
| `SELF_SIGNED_CERT_IN_CHAIN`, `unable to verify the first certificate` | нет CA для T-Invest MCP: `node scripts/fetch-mcp-ca.mjs`, затем `MCP_TINKOFF_TLS_MODE=extra-ca` и `MCP_TINKOFF_CA_FILE=certs/mcp-chain.pem` |
| `mcp_unauthorized` (503) | токен T-Invest неверный или без нужных прав — перевыпустите read-only токен |
| `llm: down` в `/health` | не заполнены или истекли креденшелы выбранного провайдера |
| `409 NOT_AWAITING_APPROVAL` | у сессии нет ожидающего подтверждения: начните новый вопрос |
| `410 APPROVAL_EXPIRED` | подтверждение пришло позже `APPROVAL_TTL_MINUTES` (15 мин) — повторите вопрос |
| Ответ «зависает» на минуты (GigaChat) | включён streaming: `GIGACHAT_STREAMING=false` |
| Клиент отваливается по таймауту | клиентский таймаут должен быть больше `RUN_DEADLINE_MS` (240 с) |
| `partial: true` в ответе | исчерпан бюджет вызовов или дедлайн: смотрите `report.coverage` и «Недоступные источники» |
| Пустая сводка новостей | проверьте `SOURCES`/`NEWS_SOURCES` и `NEWS_FEED_PERIODS`; недоступные источники видны в покрытии |
| «сектор не определён» | брокер не вернул `brand.sector`; сектор подтягивается цепочкой `share → asset → brand` |
| После `docker compose up` отчёт не собирается | проверьте тома `./data`, `./.state`, `./certs` и что `certs/mcp-chain.pem` создан |

---

## Документация

| Документ | О чём |
|---|---|
| [`docs/architecture.md`](docs/architecture.md) | модули, правила зависимостей, контракты расширения, чек-лист ревью |
| [`docs/api.md`](docs/api.md) | эндпоинты, `intent`, коды ошибок, примеры |
| [`docs/mcp.md`](docs/mcp.md) | MCP-серверы, allowlist, прокси, TLS |
| [`docs/sources.md`](docs/sources.md) | источники данных и новостей, как добавить ленту |
| [`docs/knowledge.md`](docs/knowledge.md) | база знаний: формат тем, отбор контекста |
| [`docs/reports.md`](docs/reports.md) | шаблон отчёта, секции, карточка бумаги, секторы |
| [`docs/dialogues.md`](docs/dialogues.md) | корзина диалогов и эталонные ответы |
| [`docs/state.md`](docs/state.md) | SQLite, TTL сессий и отчётов |
| [`docs/approvals.md`](docs/approvals.md) | правила подтверждений |
| [`docs/llm-providers.md`](docs/llm-providers.md) | провайдеры моделей |
| [`docs/observability.md`](docs/observability.md) | логи, маскирование, трассировка |

Правила разработки агента и базы знаний — в скиллах:
[`.agents/skills/agent-engineering`](.agents/skills/agent-engineering/SKILL.md) и
[`.agents/skills/knowledge-base`](.agents/skills/knowledge-base/SKILL.md).

Спецификации и завершённые изменения — в [`openspec/`](openspec/).

