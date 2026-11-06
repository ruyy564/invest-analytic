# LLM-провайдеры

Реестр провайдеров: `src/platform/llm/llm-registry.ts`. Модель создаётся в одном месте, узлы графа получают её через DI-токены `LLM_ANSWER_MODEL` и `LLM_ROUTER_MODEL`.

## Поддерживаемые провайдеры

| `LLM_PROVIDER` | Библиотека | Обязательные переменные |
|---|---|---|
| `gigachat` | `langchain-gigachat` | `LLM_MODEL`, `GIGACHAT_CREDENTIALS` |
| `openai` | `@langchain/openai` | `LLM_MODEL`, `LLM_API_KEY` |
| `openai-compatible` | `@langchain/openai` + `baseURL` | `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL` |

Общие переменные: `LLM_ROUTER_MODEL` (по умолчанию `LLM_MODEL`), `LLM_TEMPERATURE`.

Креденшелы проверяются **только** для выбранного провайдера: `openai` не требует `GIGACHAT_*`, `gigachat` не требует `LLM_API_KEY`. При неизвестном значении `LLM_PROVIDER` сервис не стартует и перечисляет поддерживаемые варианты.

## Роли моделей

- `answer` — `LLM_MODEL`: формирование ответа агенту.
- `router` — `LLM_ROUTER_MODEL`: классификация вопроса. Дешёвая модель экономит токены на каждом запросе.

## Особенности GigaChat

1. **Двойное форматирование инструментов.** `bindTools` конвертирует инструменты и повторно — в `invocationParams`, из-за чего вызов падает. Поэтому используется `bindToolsCompat` (`src/platform/llm/bind-tools.ts`): для моделей с `formatStructuredToolToGigaChat` инструменты привязываются через `RunnableBinding` с готовыми `functions`.
2. **zod 3 для схем инструментов.** `langchain-gigachat` конвертирует схемы через `zod-to-json-schema`, который понимает только zod 3. Пакет `zod@4` экспортирует оба API, поэтому в местах, где схема уходит в GigaChat, используется `import { z } from 'zod/v3'`.
3. **Структурированный вывод.** Если `withStructuredOutput` падает, `invokeStructured` (`src/platform/llm/structured-output.ts`) повторяет запрос с инструкцией «ответь одной меткой» и разбирает текст.
4. **Внутренний контур.** Для него задаётся `GIGACHAT_AUTH_URL`; TLS-проверка по умолчанию **не** отключается.

## Как добавить провайдера

1. Создайте `src/platform/llm/providers/<id>.provider.ts`, реализующий `LlmProvider`:
   - `id` — значение для `LLM_PROVIDER`;
   - `createChatModel(role)` — возвращает `BaseChatModel`;
   - параметры вынесите в отдельную функцию (`build<Name>Params`), чтобы их можно было проверить тестом.
2. Добавьте `<id>` в `SUPPORTED_LLM_PROVIDERS` (`src/platform/config/env.schema.ts`) и, если нужны свои переменные, — в `superRefine` для условной проверки.
3. Зарегистрируйте провайдера в `createProviderMap`.
4. Допишите переменные в `.env.example` и в таблицу `README.md` — тест `test/unit/env-example.spec.ts` следит за соответствием набора ключей схеме.
5. Добавьте юнит-тест на `build<Name>Params` и на выбор модели по роли.

Код узлов графа и промптов при этом не меняется.

## Тестовый провайдер

`test/fixtures/fake-chat-model.ts` содержит `ScriptedChatModel` (детерминированные ответы и `tool_calls`, без сети и ключей) и `FakeLlmProvider`. Подключение:

```ts
const providers = createProviderMap(llmSection('fake'), [new FakeLlmProvider(['ответ'])]);
```

Это позволяет прогонять граф в тестах, не обращаясь к реальному провайдеру.
