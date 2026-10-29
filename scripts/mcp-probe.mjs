/**
 * Диагностика MCP сырым JSON-RPC (без SDK): initialize -> notifications/initialized -> tools/list.
 * Запуск: node --env-file=.env scripts/mcp-probe.mjs
 * Для самоподписанного CA: NODE_EXTRA_CA_CERTS=certs/mcp-chain.pem
 * С `PROXY_PORT` поднимается HTTP-прокси, к которому можно подключить адаптер LangChain.
 */
import { createServer } from 'node:http';

/** HTTP-прокси: отдаёт стриминговые ответы сервера как обычный JSON. */
const startProxy = (port, target) =>
  new Promise((resolve) => {
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const upstream = await fetch(target.url, {
        method: request.method,
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(target.token ? { authorization: `Bearer ${target.token}` } : {}),
          ...(request.headers['mcp-session-id']
            ? { 'mcp-session-id': String(request.headers['mcp-session-id']) }
            : {}),
        },
        body: body || undefined,
      });
      const sessionId = upstream.headers.get('mcp-session-id');
      const contentType = upstream.headers.get('content-type') ?? '';
      let payload = '';
      if (contentType.includes('application/json')) {
        payload = await upstream.text();
      } else {
        // SSE: ответ может прийти несколькими блоками `data:` — разбираем до валидного JSON.
        const decoder = new TextDecoder();
        let buffer = '';
        let found;
        for await (const chunk of upstream.body) {
          buffer += decoder.decode(chunk, { stream: true });
          for (const line of buffer.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const candidate = line.slice(5).trim();
            if (!candidate) continue;
            try {
              JSON.parse(candidate);
              found = candidate;
              break;
            } catch {
              // блок ещё не полный
            }
          }
          if (found) break;
        }
        payload = found ?? '';
      }
      response.writeHead(upstream.status === 202 ? 200 : upstream.status, {
        'content-type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      });
      response.end(payload);
    });
    server.listen(port, '127.0.0.1', () => {
      console.log('proxy:', `http://127.0.0.1:${port}/mcp ->`, target.url);
      resolve(server);
    });
  });

const url = process.env.MCP_TINKOFF_URL;
const token = process.env.MCP_TINKOFF_TOKEN;
if (!url) {
  console.error('MCP_TINKOFF_URL is not set');
  process.exit(1);
}

const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

async function readRpc(response, id) {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    return response.json();
  }
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8');
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.id === id) return parsed;
      } catch {
        // неполная строка — ждём следующий чанк
      }
    }
  }
  return undefined;
}

const started = Date.now();
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
console.log('initialize:', init.status, `${Date.now() - started} ms, session=${sessionId}`);
console.log(JSON.stringify(await readRpc(init, 1)).slice(0, 200));

const sessionHeaders = { ...headers, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
await fetch(url, {
  method: 'POST',
  headers: sessionHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
}).then((response) => response.text());

const listStarted = Date.now();
const list = await fetch(url, {
  method: 'POST',
  headers: sessionHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  signal: AbortSignal.timeout(30000),
});
const listBody = await readRpc(list, 2);
const names = (listBody?.result?.tools ?? []).map((tool) => tool.name);
console.log('tools/list:', list.status, `${Date.now() - listStarted} ms, tools:`, names.length);
console.log(names.join(', '));

if (process.env.PROXY_PORT) {
  await startProxy(Number(process.env.PROXY_PORT), { url, token });
} else {
  process.exit(0);
}
