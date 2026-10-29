import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module.js';
import { ApiModule } from './api/api.module.js';
import { ConfigModule } from './config/config.module.js';
import { LlmModule } from './llm/llm.module.js';
import { ObservabilityModule } from './observability/observability.module.js';
import { StateModule } from './state/state.module.js';
import { ToolsModule } from './tools/tools.module.js';

@Module({
  imports: [
    ConfigModule,
    ObservabilityModule,
    LlmModule,
    ToolsModule,
    StateModule,
    AgentModule,
    ApiModule,
  ],
})
export class AppModule {}
