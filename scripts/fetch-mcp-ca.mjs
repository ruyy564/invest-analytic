import { writeFileSync } from 'node:fs';
import tls from 'node:tls';

/** Сохраняет цепочку сертификатов MCP-сервера в PEM — для MCP_<NAME>_CA_FILE. */
const url = process.env.MCP_TINKOFF_URL ?? process.argv[2];
const out = process.argv[3] ?? 'certs/mcp-chain.pem';
if (!url) {
  console.error('укажите MCP_TINKOFF_URL или URL аргументом');
  process.exit(1);
}

const host = new URL(url).hostname;
const socket = await new Promise((resolve, reject) => {
  const s = tls.connect({ host, port: 443, servername: host }, () => resolve(s));
  s.on('error', reject);
});

const toPem = (raw) =>
  `-----BEGIN CERTIFICATE-----\n${raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`;

const blocks = [];
let current = socket.getPeerCertificate(true);
let depth = 0;
while (current && depth < 6) {
  blocks.push(toPem(current.raw));
  current = current.issuerCertificate && current.issuerCertificate !== current ? current.issuerCertificate : undefined;
  depth += 1;
}
socket.end();

writeFileSync(out, blocks.join(''));
console.log(`сохранено ${blocks.length} сертификат(ов) в ${out}`);
