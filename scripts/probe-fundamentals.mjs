/** Проба: фундаментал, консенсус, сигналы, инсайдеры по SBER. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { trustExtraCa } from '../dist/mcp/proxy-upstream.js';

try {
  trustExtraCa('certs/mcp-chain.pem');
} catch {
  // публичный сертификат
}
mkdirSync('.probe', { recursive: true });

const url = process.env.MCP_TINKOFF_URL;
const token = process.env.MCP_TINKOFF_TOKEN;
const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};
const readRpc = async (response, id) => {
  if ((response.headers.get('content-type') ?? '').includes('application/json')) return response.json();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += Buffer.from(chunk).toString('utf8');
    for (const line of buffer.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.id === id) return parsed;
      } catch {
        // ждём
      }
    }
  }
  return undefined;
};
const init = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'probe', version: '1' } },
  }),
  signal: AbortSignal.timeout(30_000),
});
const sessionId = init.headers.get('mcp-session-id');
await readRpc(init, 1);
const sessionHeaders = { ...headers, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) };
await fetch(url, {
  method: 'POST',
  headers: sessionHeaders,
  body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
}).then((r) => r.text());

let nextId = 10;
const call = async (name, args, limit = 900) => {
  const id = (nextId += 1);
  const response = await fetch(url, {
    method: 'POST',
    headers: sessionHeaders,
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await readRpc(response, id);
  const text = body?.result?.content?.map((part) => part.text ?? '').join('') ?? '';
  writeFileSync(`.probe/${name}-${id}.json`, text || JSON.stringify(body ?? {}, null, 1));
  const preview = text.replace(/\s+/g, ' ');
  console.log(`\n### ${name} ${JSON.stringify(args)} → ${preview.length} символов`);
  console.log(preview.slice(0, limit));
  return text;
};

await call('invest_get_asset_fundamentals', { assets: ['SBER_TQBR'] });
await call('invest_get_asset_fundamentals', { assets: ['SBER'] });
await call('invest_get_asset_fundamentals', { instrumentId: 'SBER_TQBR' });
await call('invest_list_consensus_forecasts', { instrumentId: 'SBER_TQBR' });
await call('invest_list_consensus_forecasts', {});
await call('invest_get_insider_deals', { instrumentId: 'SBER_TQBR' });
await call('invest_list_signals', {});
await call('invest_get_tech_analysis', { instrumentId: 'SBER_TQBR' });
