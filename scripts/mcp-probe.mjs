/**
 * Диагностика MCP по сырому JSON-RPC (без SDK): initialize → tools/list.
 * Запуск: node --env-file=.env scripts/mcp-probe.mjs
 */
const url = process.env.MCP_TINKOFF_URL;
const token = process.env.MCP_TINKOFF_TOKEN;
if (!url) {
  console.error('MCP_TINKOFF_URL не задан');
  process.exit(1);
}

const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

const readBody = async (response) => {
  let text = '';
  for await (const chunk of response.body) {
    text += Buffer.from(chunk).toString('utf8');
  }
  return text;
};

const t0 = Date.now();
const init = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'probe', version: '1' },
    },
  }),
});
const sessionId = init.headers.get('mcp-session-id');
console.log('initialize:', init.status, `${Date.now() - t0} мс, session=${sessionId}`);
console.log((await readBody(init)).slice(0, 200));

const sessionHeaders = { ...headers, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
await fetch(url, {
  method: 'POST',
  headers: sessionHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
}).then((r) => r.text());

const t1 = Date.now();
const list = await fetch(url, {
  method: 'POST',
  headers: sessionHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  signal: AbortSignal.timeout(30000),
});
const listBody = await readBody(list);
const names = [...listBody.matchAll(/"name\\?":\\?"([a-z_0-9]+)/g)].map((match) => match[1]);
console.log('tools/list:', list.status, `${Date.now() - t1} мс, инструментов:`, names.length);
console.log(names.join(', '));
process.exit(0);
