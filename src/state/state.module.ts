import { Module } from '@nestjs/common';

/** Чекпоинтер состояния прогонов (SqliteSaver или MemorySaver по конфигурации). */
export const CHECKPOINTER = Symbol('CHECKPOINTER');
/** Глобальное хранилище общих данных (счёт по умолчанию и прочие настройки). */
export const GLOBAL_STORE = Symbol('GLOBAL_STORE');

/** Персистентное состояние реализуется в группе 8. */
@Module({})
export class StateModule {}
