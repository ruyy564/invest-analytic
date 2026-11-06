import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { AppConfigService } from './app-config.service.js';
import { loadConfiguration } from './configuration.js';

/**
 * Единственная точка чтения окружения: `.env` подхватывается автоматически,
 * затем значение валидируется zod-схемой (fail-fast при некорректной конфигурации).
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => loadConfiguration()],
    }),
  ],
  providers: [AppConfigService],
  exports: [AppConfigService],
})
export class ConfigModule {}
