import { Module } from '@nestjs/common';
import { MemorySaver } from '@langchain/langgraph';

/** Чекпоинтер состояния прогонов. SQLite-бэкенд подключается в группе 8. */
export const CHECKPOINTER = Symbol('CHECKPOINTER');
/** Глобальное хранилище общих данных (счёт по умолчанию и прочие настройки). */
export const GLOBAL_STORE = Symbol('GLOBAL_STORE');

@Module({
  providers: [{ provide: CHECKPOINTER, useFactory: () => new MemorySaver() }],
  exports: [CHECKPOINTER],
})
export class StateModule {}

