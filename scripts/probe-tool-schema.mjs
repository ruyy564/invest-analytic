import { MultiServerMCPClient } from '@langchain/mcp-adapters';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod/v3';
import { GigaChat } from 'langchain-gigachat';
import { toolSchemaFrom } from '../src/tools/tool-schema.ts';

const client = new MultiServerMCPClient({
  prefixToolNameWithServerName: false,
  mcpServers: { tinkoff: { transport: 'http', url: 'http://127.0.0.1:3001/mcp' } },
});
const tools = await client.getTools('tinkoff');
const model = new GigaChat({
  credentials: process.env.GIGACHAT_CREDENTIALS,
  scope: process.env.GIGACHAT_SCOPE,
  authUrl: process.env.GIGACHAT_AUTH_URL,
  model: process.env.LLM_ROUTER_MODEL,
});

for (const tool of tools.slice(0, 2)) {
  const info = toolSchemaFrom(tool.schema);
  const wrapped = new DynamicStructuredTool({
    name: tool.name,
    description: tool.description,
    schema: z.record(z.any()).describe(JSON.stringify(info)),
    func: async () => 'ok',
  });
  try {
    const functions = model.formatStructuredToolToGigaChat([wrapped]);
    console.log('OK', tool.name, 'required:', JSON.stringify(info.required), 'payload:', JSON.stringify(functions).length);
  } catch (error) {
    console.log('FAIL', tool.name, String(error?.message ?? error).slice(0, 120));
  }
}
