import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { AppConfigService } from './config/app-config.service.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const config = app.get(AppConfigService).value;
  await app.listen(config.app.port);

  new Logger('Bootstrap').log(
    `Сервис слушает порт ${config.app.port} (LLM: ${config.llm.provider}/${config.llm.model}, ` +
      `MCP: ${config.mcp.servers.map((server) => server.name).join(', ')})`,
  );
}

void bootstrap();
