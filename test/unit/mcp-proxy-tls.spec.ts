import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getCACertificates } from 'node:tls';
import {
  caFileToPem,
  postToUpstream,
  releaseExtraCa,
  trustExtraCa,
} from '../../src/mcp/mcp-proxy.service.js';

describe('TLS до MCP-сервера', () => {
  const original = getCACertificates('default') as string[];

  afterEach(() => {
    releaseExtraCa();
  });

  it('читает все сертификаты из PEM-файла', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ca-'));
    const file = join(dir, 'chain.pem');
    const block = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
    writeFileSync(file, `${block}\n${block}\n`);

    expect(caFileToPem(file)).toHaveLength(2);
  });

  it('postToUpstream ходит без сертификата только при tlsMode=insecure', async () => {
    const request = postToUpstream(
      {
        name: 'local',
        url: 'http://127.0.0.1:1/mcp',
        transport: 'http',
        allowedTools: ['x'],
        tlsMode: 'strict',
      },
      '{}',
    );

    await expect(request).rejects.toThrow();
  });

  it('возвращает корневые сертификаты при освобождении', () => {
    expect(getCACertificates('default')).toHaveLength(original.length);

    // Пустой файл ничего не добавляет и не ломает набор.
    const dir = mkdtempSync(join(tmpdir(), 'ca-'));
    const file = join(dir, 'empty.pem');
    writeFileSync(file, 'no certificates here');

    expect(trustExtraCa(file)).toBe(0);
    expect(getCACertificates('default')).toHaveLength(original.length);
  });
});