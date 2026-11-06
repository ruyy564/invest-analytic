import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module.js';
import { ApiModule } from './transports/http/api.module.js';
import { ConfigModule } from './platform/config/config.module.js';
import { LlmModule } from './platform/llm/llm.module.js';
import { ObservabilityModule } from './platform/observability/observability.module.js';
import { LoggingModule } from './platform/logging/index.js';
import { StateModule } from './platform/state/state.module.js';
import { ToolsModule } from './tools.module.js';

@Module({
  imports: [
    ConfigModule,
    LoggingModule,
    ObservabilityModule,
    LlmModule,
    ToolsModule,
    StateModule,
    AgentModule,
    ApiModule,
  ],
})
export class AppModule {}
