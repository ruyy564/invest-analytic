# Состояние

## Бэкенды

| `STATE_BACKEND` | Что используется | Где живёт |
|---|---|---|
| `sqlite` (по умолчанию) | `SqliteSaver` из `@langchain/langgraph-checkpoint-sqlite` на `better-sqlite3` | файл `STATE_SQLITE_PATH` (по умолчанию `./data/state.sqlite`) |
| `memory` | `MemorySaver` | процесс; для тестов и разовых прогонов |

Каталог файла создаётся на старте, режим журнала — WAL. Таблицы чекпоинтера создаёт сам `SqliteSaver`.

## Что хранится

- состояние прогона по `thread_id = sessionId`: сообщения, интент, ожидающие подтверждения;
- глобальное хранилище `app_global_state(namespace, key, value, updated_at)` — общие данные, переживающие перезапуск. Namespace — `users/<USER_ID>`.

Сейчас в глобальном хранилище живут `defaultAccountId` и `schemaVersion`.

## Что запрещено хранить

Состав портфеля, позиции и суммы **не** попадают в глобальное хранилище: `GlobalStoreService` отклоняет ключи, содержащие `portfolio`, `position`, `holding`, `позиц`, `количеств`. Иначе данные можно было бы прочитать, не проходя подтверждение.

## Очистка

`APPROVAL_TTL_MINUTES` ограничивает срок жизни конкретного подтверждения (по умолчанию 15 минут), `STATE_TTL_DAYS` задаёт горизонт очистки брошенных сессий (по умолчанию 30 дней).

## Переход на Postgres

`createCheckpointer` — единственное место выбора реализации. Для продакшена достаточно добавить `PostgresSaver`/`PostgresStore` в эту фабрику и расширить `STATE_BACKEND`, узлы графа и интерфейсы не меняются.

## Проверка

```bash
STATE_BACKEND=sqlite STATE_SQLITE_PATH=./data/state.sqlite npm start
```

После перезапуска продолжение той же сессии восстанавливает историю и ожидающие подтверждения — это проверяет `test/unit/state-persistence.spec.ts` (сохранение между экземплярами хранилища).
