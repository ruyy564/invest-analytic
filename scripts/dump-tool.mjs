// Диагностика формы ответа MCP: печатает сырой JSON инструмента.
// Использование: node scripts/dump-tool.mjs invest_get_asset '{"instrumentId":"...","idType":"..."}'
import 'dotenv/config';
import { loadConfiguration } from '../dist/platform/config/configuration.js';
import { McpProxyService } from '../dist/transports/mcp/mcp-proxy.service.js';
import { MultiServerMcpFactory } from '../dist/transports/mcp/mcp-client.factory.js';
import { McpRegistryService } from '../dist/transports/mcp/mcp-registry.service.js';

const [toolName = 'invest_get_share', rawArgs = '{"instrumentId":"SBER_TQBR","idType":"INSTRUMENT_ID_TYPE_TICKER"}'] =
  process.argv.slice(2);

const config = loadConfiguration();
const configService = { value: config };
const needsProxy = (server) => !/127\.0\.0\.1|localhost|::1/.test(new URL(server.url).hostname);
const factory = new MultiServerMcpFactory(new McpProxyService(configService), needsProxy);
const registry = new McpRegistryService(configService, factory.create);
await registry.ensureInitialized();

const tool = registry.toolByName(toolName);
if (!tool) {
  console.error(`инструмент ${toolName} недоступен в allowlist`);
  await factory.close();
  process.exit(1);
}

try {
  const raw = await tool.invoke(JSON.parse(rawArgs));
  console.log(String(raw).slice(0, 6000));
} catch (error) {
  console.error(`ошибка вызова: ${error?.message ?? error}`);
}

await factory.close();
process.exit(0);
