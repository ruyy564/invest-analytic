import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module.js';

/** Контроллеры чата и health добавляются в группе 6. */
@Module({
  imports: [AgentModule],
})
export class ApiModule {}
