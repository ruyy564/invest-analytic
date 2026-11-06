# Структура кода

Документ отвечает на два вопроса: «куда положить новое» и «где искать логику».
Правила проверяются тестом `test/unit/architecture.spec.ts` — нарушение ломает
сборку, а не обсуждается на ревью.

## Принцип

Папка верхнего уровня — это **возможность** (то, о чём говорит пользователь), а
не тип файла. Внутри возможности — **роль**: домен, сервисы, адаптеры, инструменты
модели, представление.

```
src/
├─ platform/          сквозное: config, логирование, трассировка, шлюз, журнал прогонов
├─ shared/            чистые утилиты без домена (не «common», не «helpers»)
├─ capabilities/      вертикальные срезы
│  ├─ news/
│  │  ├─ domain/      CanonicalItem, политика (чистые функции)
│  │  ├─ pipeline/    стадии: policy, dedupe, stage-report
│  │  ├─ sources/     источники и экстракторы (по файлу на источник)
│  │  ├─ tools/       фасады для модели (появляются на этапе 5)
│  │  └─ index.ts     публичный контракт возможности
│  └─ …               portfolio, instruments, knowledge, market, reports
├─ agent/             только оркестрация: graph, nodes, services, prompts
└─ transports/        входы: http (контроллеры), mcp (клиент и адаптер)
```

Перенос выполнен: `capabilities/news`, `capabilities/instruments`,
`capabilities/knowledge`, `capabilities/market`, `transports/mcp`,
`transports/http`, `platform/{logging,runs,http}`, `shared/money`. Старые пути
(`src/news`, `src/key-rate`, `src/commodities`, `src/mcp`, `src/api`,
`src/knowledge`, `src/parsing/mappers/money.ts`) оставлены re-export'ами —
импорты продолжают работать, а код живёт в новом месте.

## Правила зависимостей

| Из | Можно | Нельзя |
|---|---|---|
| `capabilities/x/domain` | чистые типы и функции | Nest, LangChain, `node:fs`, `node:http` |
| `capabilities/x/*` | `platform`, `shared`, свой домен | `agent` |
| `capabilities/x` → `capabilities/y` | только `capabilities/y/index.ts` | внутренние файлы другой возможности |
| `platform` | `shared` | `capabilities`, `agent` |
| `agent` | `capabilities/*/index.ts`, `platform`, `shared` | внутренности возможностей |
| `transports` | `agent`, `platform` | бизнес-логику |

## Лимиты размера

| Роль | Файл | Сигнал к разделению |
|---|---|---|
| нода | ≤60 строк | появились циклы по данным или `try/catch` с бизнес-фолбэком |
| сервис | ≤200 строк | смешаны расчёт и ввод-вывод |
| адаптер | ≤150 строк | внутри появились правила отбора |
| инструмент модели | ≤60 строк | парсинг ответа или форматирование |
| домен | ≤200 строк | появились `async`/сеть |

## Куда положить новое

| Что | Куда | Регистрация | Тест |
|---|---|---|---|
| Нода | `agent/nodes/<name>.node.ts` | `graph/build-graph.ts` | `test/unit/<name>.spec.ts` |
| Тул | `capabilities/<domain>/tools/<name>.tool.ts` | реестр тулов | схема + tool-choice кейс |
| Источник новостей | `capabilities/news/sources/<id>.ts` | `news/news.factory.ts` | `test/contract/<id>.spec.ts` + golden |
| Правило релевантности | `data/policy/news.yaml` | — | `test/unit/news-policy.spec.ts` |
| Тема знаний | `data/knowledge/NN-<id>.yaml` | — | `test/unit/knowledge*.spec.ts` |
| Секция отчёта | `capabilities/reports/sections/<group>/<id>.section.ts` | шаблон `reports/*.yaml` | `test/unit/<id>.spec.ts` |
| Кейс оценки | `test/eval/cases/*.json` | — | `npm run eval` |
| Сквозная утилита | `platform/<area>/` | `index.ts` | unit |

## Чек-листы

**Источник новостей**
1. `<id>.source.ts`: только получение (URL, таймаут, заголовки), сеть — через шлюз.
2. `<id>.extract.ts` или `parse*`: только разбор в `SourceItem` (с `instrumentTags`, если источник помечает бумаги).
3. Запись в `news.factory.ts` + `data/policy/news.yaml` для новых правил.
4. `test/fixtures/golden/<id>.*` — реальный ответ, обезличенный.
5. `test/contract/<id>.spec.ts` — число элементов и ключевые поля.

**Инструмент модели**
1. Сервис в `capabilities/<domain>/services/` — логика без LangChain.
2. Тул: схема аргументов, описание «когда звать / когда нет».
3. Регистрация в каталоге тулов.
4. Snapshot схемы + 3 кейса «должен выбрать» и 3 «не должен».

**Нода**
1. Только `state → сервис → Partial<State>`, ≤60 строк.
2. Ребро/условие в `build-graph.ts`.
3. Тест на дельту состояния и аргументы сервиса.
4. Третье ветвление — повод вынести сервис.

**Секция отчёта**
1. Файл секции: `id`, области (`scope`), обязательные факты, рендер.
2. Строка в шаблоне (`optional`, `knowledge`).
3. Тест на фикстурах фактов + фрагмент в кейсе оценки.

## Карта поиска

| Вопрос | Где смотреть |
|---|---|
| Почему новость не про бумагу? | `data/policy/news.yaml` → `capabilities/news/domain/news-policy.ts` |
| Почему в ответе мусор из ленты? | `test/fixtures/golden` → `capabilities/news/pipeline/stage-report.ts` |
| Откуда цифра в отчёте? | `report/providers/**` (до переноса) → `capabilities/reports/sections/**` |
| Почему такой маршрут? | `agent/nodes/classify` → `agent/graph/routers.ts` |
| Почему модель ответила отказом? | `agent/nodes/agent/agent.node.ts` (`REFUSAL`) |
| Почему запрос требует подтверждения? | `agent/approvals/*` + `agent/nodes/approve` |
| Что произошло в прогоне? | `STATE_RUNS_DIR/<runId>.jsonl`, `npm run replay -- <runId>` |
| Как измеряется качество? | `docs/evals.md`, `test/eval/cases` |
