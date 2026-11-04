import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { AgentModule } from '../agent/agent.module.js';
import { StateModule } from '../state/state.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { AgentController } from './agent.controller.js';
import { HttpExceptionFilter } from './filters/http-exception.filter.js';
import { HealthController } from './health.controller.js';
import { ReportsController } from './reports.controller.js';

@Module({
  imports: [AgentModule, ToolsModule, StateModule],
  controllers: [AgentController, HealthController, ReportsController],
  providers: [{ provide: APP_FILTER, useClass: HttpExceptionFilter }],
})
export class ApiModule {}

