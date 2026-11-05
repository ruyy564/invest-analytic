import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AppConfigService } from '../../config/app-config.service.js';
import { McpRegistryService } from '../../mcp/mcp-registry.service.js';

interface ComponentStatus {
  status: 'up' | 'down';
  details?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  components: Record<string, ComponentStatus>;
}

/** Health-проверка: LLM по конфигурации (без платного вызова) и discovery по каждому MCP. */
@Controller('health')
export class HealthController {
  constructor(
    private readonly registry: McpRegistryService,
    private readonly config: AppConfigService,
  ) {}

  @Get()
  async check(@Res({ passthrough: true }) response: Response): Promise<HealthResponse> {
    await this.registry.ensureInitialized();

    const components: Record<string, ComponentStatus> = {
      llm: {
        status: 'up',
        details: `${this.config.value.llm.provider}/${this.config.value.llm.model}`,
      },
    };

    for (const server of this.registry.serverStatuses) {
      const coverage =
        server.status === 'up'
          ? [
              `инструментов: ${server.tools.length}`,
              server.missingTools.length > 0 ? `нет в каталоге: ${server.missingTools.length}` : '',
              server.unlistedTools.length > 0 ? `вне allowlist: ${server.unlistedTools.length}` : '',
            ]
              .filter((part) => part !== '')
              .join(', ')
          : '';

      components[`mcp:${server.name}`] = {
        status: server.status === 'up' ? 'up' : 'down',
        details: server.status === 'up' ? coverage : (server.error ?? 'недоступен'),
      };
    }

    const healthy = this.registry.isHealthy();
    response.status(healthy ? 200 : 503);

    return { status: healthy ? 'ok' : 'error', components };
  }
}
