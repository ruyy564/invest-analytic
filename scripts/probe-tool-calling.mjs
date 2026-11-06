import { GigaChat } from 'langchain-gigachat';
import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { toolSchemaFrom } from '../src/transports/mcp/tool-schema.ts';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { RunnableBinding } from '@langchain/core/runnables';

const client = new MultiServerMCPClient({
  prefixToolNameWithServerName: false,
  mcpServers: { tinkoff: { transport: 'http', url: 'http://127.0.0.1:3001/mcp' } },
});
const all = await client.getTools('tinkoff');
const allowed = all.filter((t) => ['invest_list_accounts', 'invest_get_portfolio'].includes(t.name));

const tools = allowed.map((tool) => {
  const info = toolSchemaFrom(tool.schema);
  return new DynamicStructuredTool({
    name: tool.name,
    description: `${tool.description}\nArguments JSON Schema: ${JSON.stringify(info)}`,
    schema: z.record(z.any()),
    func: async () => 'ok',
  });
});

const model = new GigaChat({
  credentials: process.env.GIGACHAT_CREDENTIALS,
  scope: process.env.GIGACHAT_SCOPE,
  authUrl: process.env.GIGACHAT_AUTH_URL,
  model: process.env.LLM_MODEL,
});

const bound = new RunnableBinding({
  bound: model,
  kwargs: { tools: model.formatStructuredToolToGigaChat(tools) },
  config: {},
});

const response = await bound.invoke([
  new SystemMessage(
    'Ты показываешь портфель. Сначала вызови invest_list_accounts, затем invest_get_portfolio с accountId из ответа.',
  ),
  new HumanMessage('что у меня в портфеле?'),
]);

console.log('tool_calls:', JSON.stringify(response.tool_calls));
