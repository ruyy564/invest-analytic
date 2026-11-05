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
| Объяснение понятий | «что такое дюрация?», «что такое P/E?» | ответ из базы знаний: определение, тезисы, подразделы, ошибки, источники |
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
| Справочный контекст | принципы из базы знаний под секторы портфеля или под бумагу (до трёх тезисов на тему); секция необязательная |
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
        ├─ knowledge_question ──────────────────▶ база знаний (код, без модели)
        └─ agent_help ──────────────────────────▶ справка (код, без модели)
```

- Граф LangGraph с чекпоинтером: прерывание на `approve` переживает перезапуск процесса.
- Данные портфеля читаются только после подтверждения; новости, знания и справка — без
  доступа к счёту.
- Отчёт собирается по шаблону `reports/portfolio-review.yaml`: состав, порядок, пороги и
  темы знаний меняются файлом, без правок кода.
- Числа считает код; модель только трактует факты и помечает выводы «(оценка)».

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

### Выгрузка готового отчёта

```bash
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=md"    # по умолчанию
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=json"
curl -s "http://localhost:3000/api/v1/reports/<reportId>?format=html"  # для печати/PDF
```

---

## API

| Метод | Путь | Ответ |
|---|---|---|
| `POST` | `/api/v1/agent/chat` | `200` — ответ; `202` — нужно подтверждение |
| `POST` | `/api/v1/agent/chat/approve` | `approved: true\|false`; `200`/`202` |
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
  api/                    HTTP: controllers (agent, health, reports), dto, filters
  agent/                  граф и узлы
    agent-runner.service.ts   run / approve / отчёт
    graph/                    state, routers, build-graph
    nodes/<node>/             узел + промпт рядом (classify, agent, review, news, help, knowledge)
    approvals/                правила подтверждений
    scope.ts                  «портфель / счёт / бумага» по вопросу
  collection/             план сбора данных и его исполнение (группы, приоритеты, бюджет)
  report/                 отчёт: шаблон, движок фактов, провайдеры, рендер
    engine.ts               сборка фактов по секциям
    compose.ts              итоговый markdown (шапка с датой данных)
    sparkline.ts            график-спарклайн из свечей
    company-profiles.ts     драйверы секторов и профили «экспортёр / внутренний рынок»
    providers/portfolio/    table, structure, exposure, concentration, gaps
    providers/securities/   detail, opinions, bond-facts
  news/                   ленты, фильтры, алиасы, реестр источников
    sources/                RSS (Ведомости, Коммерсантъ, ТАСС, Финам, РБК, Интерфакс,
                            smart-lab) + HTML-страницы rbc-quote и tbank-research
  key-rate/               ключевая ставка ЦБ (SOAP → кэш → сид → HTML)
  commodities/            учётные цены металлов ЦБ (золото, серебро, платина, палладий)
  knowledge/              база знаний: репозиторий, отбор тем, формат ответа
  mcp/                    транспорт MCP: реестр, прокси, адаптер, схемы, бюджет
  tools/<tool>/           инструменты для модели: <tool>.tool.ts (схема) + <tool>.service.ts
  llm/                    реестр провайдеров, bind-tools, structured output
  state/                  чекпоинтер, хранилище отчётов, глобальные настройки, очистка
  config/                 zod-схема env, типизированный конфиг, fail-fast
  parsing/                разбор ответов MCP, YAML и лент (mappers/, yaml.ts, feed.ts, html.ts)
  observability/          структурные логи, маскирование секретов, трейсы

data/
  knowledge/*.yaml        база знаний: 17 файлов-тем (файл = тема)
  company-profiles.yaml   драйверы секторов и профили компаний
  ticker-aliases.yaml     алиасы эмитентов для поиска новостей
  tax-keywords.yaml       словарь налоговых терминов
  key-rate-seed.json      офлайн-сид ключевой ставки

reports/
  portfolio-review.yaml   шаблон отчёта: секции, порядок, пороги, темы знаний
  prompts/interpretation.md  промпт для разделов, которые пишет модель

docs/                     архитектура, API, MCP, источники, знания, отчёты, состояние
scripts/                  смок-тесты и утилиты (smoke:mcp, fetch-mcp-ca, studio-check, db-info)
test/                     unit (Jest) и e2e (граф, HTTP, MCP, рестарт состояния)
certs/                    CA для T-Invest MCP (.gitignore)
.state/                   SQLite состояния и отчётов (.gitignore)
```

Куда смотреть по задаче:

| Задача | Файл |
|---|---|
| Добавить инструмент для модели | `src/tools/<tool>/` + `src/mcp/local-tools.ts` |
| Подключить MCP-сервер | `.env` (`MCP_SERVERS`, `MCP_<NAME>_*`), `docs/mcp.md` |
| Добавить источник новостей | `src/news/sources/` + `NEWS_SOURCES` |
| Добавить секцию отчёта | `reports/portfolio-review.yaml` + провайдер в `src/report/providers/` |
| Изменить порядок или пороги отчёта | только `reports/portfolio-review.yaml` |
| Добавить тему знаний | `data/knowledge/NN-<id>.yaml`, формат — `docs/knowledge.md` |
| Поправить драйверы сектора или профиль компании | `data/company-profiles.yaml` |
| Сменить модель или провайдера | `LLM_PROVIDER` + `docs/llm-providers.md` |
| Разобраться с подтверждениями | `src/agent/approvals/`, `docs/approvals.md` |

Что **не** версионируется: `.env`, `.state/`, `certs/`, `dist/`, `node_modules/`.
`data/` версионируется: это справочники и знания, а не состояние.


---

## Конфигурация

Все переменные читаются один раз при старте и проверяются zod-схемой
(`src/config/env/`). Некорректная конфигурация — падение с перечнем **всех** проблемных
переменных; значения секретов в вывод не попадают. Полный список — в
[`.env.example`](.env.example).

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
npm test                  # 330 unit-теста, 43 набора
npm run test:e2e          # 28 e2e: граф, HTTP, MCP, рестарт состояния
npm run smoke:mcp         # живое подключение к T-Invest MCP (нужен .env)
npm run studio:check      # граф виден в LangGraph Studio
```


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
  даёт справочный блок знаний.
- Ставка купона облигации оценивается по накопленному доходу между выплатами (точного
  поля в карточке нет) и помечается «(оценка)».
- Инфляции, макрокалендаря и обзоров инвест-домов в источниках нет: выводы на принципах
  помечаются «(оценка)».
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

Спецификации и завершённые изменения — в [`openspec/`](openspec/).

