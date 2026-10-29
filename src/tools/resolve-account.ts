import type { AppConfigService } from '../config/app-config.service.js';
import type { McpRegistryService } from './mcp-registry.service.js';
import { withTimeout } from './mcp-tool.adapter.js';

const ACCOUNT_LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Счёт по умолчанию: из `TINKOFF_ACCOUNT_ID`, а если он не задан — один запрос
 * к MCP (с таймаутом). Иначе модель угадывает `accountId` и подтверждение
 * приходит с пустыми аргументами.
 */
export const resolveDefaultAccount = async (
  config: AppConfigService,
  registry: McpRegistryService,
): Promise<string | undefined> => {
  const fromEnv = config.value.mcp.accountId;
  if (fromEnv) {
    return fromEnv;
  }
  try {
    return await withTimeout(
      (async () => {
        await registry.ensureInitialized();
        const tool = registry.tools.find((item) => item.name === 'tinkoff__invest_list_accounts');
        if (!tool) {
          return undefined;
        }
        const raw = await tool.invoke({} as never);
        const text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        return /"id"\s*:\s*"([^"]+)"/.exec(text)?.[1];
      })(),
      ACCOUNT_LOOKUP_TIMEOUT_MS,
      () => new Error('account lookup timeout'),
    );
  } catch {
    return undefined;
  }
};
