import { MultiServerMCPClient } from '@langchain/mcp-adapters';

const client = new MultiServerMCPClient({
  prefixToolNameWithServerName: false,
  mcpServers: {
    tinkoff: { transport: 'http', url: process.env.PROXY_URL ?? 'http://127.0.0.1:3001/mcp' },
  },
});

const tools = await client.getTools('tinkoff');
console.log('count', tools.length);
console.log('names:', tools.map((tool) => tool.name).join(','));
if (tools[0]) {
  console.log('schema:', JSON.stringify(tools[0].schema).slice(0, 300));
}
await client.close();
