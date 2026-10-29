import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module.js';
import { StateModule } from '../state/state.module.js';
import { ToolsModule } from '../tools/tools.module.js';

/** Граф, узлы и раннер прогона реализуются в группах 4–5. */
@Module({
  imports: [LlmModule, ToolsModule, StateModule],
})
export class AgentModule {}
