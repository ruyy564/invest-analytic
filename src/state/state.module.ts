import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service.js';
import { createCheckpointer } from './checkpointer.factory.js';
import { GlobalStoreService } from './global-store.service.js';

/** Чекпоинтер состояния прогонов: sqlite (по умолчанию) или memory. */
export const CHECKPOINTER = Symbol('CHECKPOINTER');
/** Глобальное хранилище общих данных (счёт по умолчанию и прочие настройки). */
export const GLOBAL_STORE = Symbol('GLOBAL_STORE');

@Module({
  providers: [
    GlobalStoreService,
    {
      provide: CHECKPOINTER,
      useFactory: (config: AppConfigService) => createCheckpointer(config.value.state),
      inject: [AppConfigService],
    },
    { provide: GLOBAL_STORE, useExisting: GlobalStoreService },
  ],
  exports: [CHECKPOINTER, GLOBAL_STORE, GlobalStoreService],
})
export class StateModule {}


