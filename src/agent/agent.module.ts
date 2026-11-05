import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/index.js';
import { LlmModule } from '../llm/llm.module.js';
import { StateModule } from '../state/state.module.js';
import { ToolsModule } from '../tools/tools.module.js';
import { AgentRunnerService } from './agent-runner.service.js';
import { ApprovalFlowService } from './approval-flow.service.js';
import { ApprovalPolicyService } from './approvals/approval-policy.service.js';

/** Граф, узлы и раннер прогона. */
@Module({
  imports: [LlmModule, ToolsModule, StateModule, KnowledgeModule],
  providers: [ApprovalPolicyService, ApprovalFlowService, AgentRunnerService],
  exports: [AgentRunnerService, ApprovalPolicyService, ApprovalFlowService],
})
export class AgentModule {}

