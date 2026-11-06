import { Global, Module } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service.js';
import { APP_LOGGER, createAppLogger } from './pino-logger.js';

/**
 * Логирование приложения: один pino-логгер на процесс. Модуль глобальный —
 * логировать нужно в любом модуле, а токен `APP_LOGGER` даёт дочерние логгеры
 * прогона.
 */
@Global()
@Module({
  providers: [
    {
      provide: APP_LOGGER,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) =>
        createAppLogger({
          level: config.value.app.logLevel,
          env: config.value.app.nodeEnv,
        }),
    },
  ],
  exports: [APP_LOGGER],
})
export class LoggingModule {}
