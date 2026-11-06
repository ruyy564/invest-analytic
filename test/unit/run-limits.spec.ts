import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AgentRunnerService } from '../../src/agent/agent-runner.service.js';
import type { ApprovalFlowService } from '../../src/agent/approval-flow.service.js';
import type { ApprovalPolicyService } from '../../src/agent/approvals/approval-policy.service.js';
import type { AppConfigService } from '../../src/platform/config/app-config.service.js';
import type { McpRegistryService } from '../../src/transports/mcp/mcp-registry.service.js';

const configStub = (deadlineMs: number): AppConfigService =>
  ({ value: { run: { deadlineMs } } }) as unknown as AppConfigService;

const registryStub = { beginRun: () => undefined, endRun: () => undefined } as unknown as McpRegistryService;

describe('дедлайн прогона', () => {
  it('прерывает зависший прогон по дедлайну из конфигурации и отдаёт частичный ответ', async () => {
    const runner = new AgentRunnerService(
      configStub(5),
      registryStub,
      {} as ApprovalPolicyService,
      {} as ApprovalFlowService,
      {} as BaseChatModel,
      {} as BaseChatModel,
      {} as never,
    );

    // Зависший граф: invoke не завершается, поэтому сработать может только дедлайн.
    const hanging = {
      invoke: () => new Promise(() => undefined),
      getState: async () => ({ values: { messages: [], intent: 'portfolio' } }),
    };
    (runner as unknown as { compiled: unknown }).compiled = hanging;

    const startedAt = Date.now();
    const result = await runner.run('что у меня в портфеле?', 'session-1', 'request-1');

    expect(result.status).toBe('completed');
    expect(result.partial).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });
});
