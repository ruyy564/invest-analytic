import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildSnapshot,
  createCbrSource,
  parseKeyRateHtml,
  parseKeyRateXml,
  soapKeyRateEnvelope,
  toHistory,
} from '../../src/sources/cbr.js';
import { KeyRateCache } from '../../src/sources/key-rate-cache.js';
import { SourceRegistry } from '../../src/sources/registry.js';
import { collectKeyRate, formatKeyRate, loadTaxKeywords } from '../../src/tools/thematic/key-rate.js';
import {
  collectTaxFacts,
  formatTaxFacts,
  matchesKeywords,
  sumTaxOperations,
} from '../../src/tools/thematic/tax-watch.js';
import type { SourceItem } from '../../src/sources/types.js';

const SOAP_XML = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
<soap:Body><KeyRateXMLResponse><KeyRateXMLResult>
<KR><DT>2026-02-16T00:00:00+03:00</DT><Rate>15.50</Rate></KR>
<KR><DT>2026-03-23T00:00:00+03:00</DT><Rate>15.00</Rate></KR>
<KR><DT>2026-03-24T00:00:00+03:00</DT><Rate>15.00</Rate></KR>
</KeyRateXMLResult></KeyRateXMLResponse></soap:Body></soap:Envelope>`;

const seedFile = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'key-rate-'));
  const path = join(dir, 'seed.json');
  writeFileSync(
    path,
    JSON.stringify({
      updatedAt: '2026-11-04T00:00:00Z',
      points: [
        { date: '2026-04-27', rate: 14.5 },
        { date: '2026-07-27', rate: 14.0 },
      ],
    }),
    'utf8',
  );
  return path;
};

describe('разбор ставки ЦБ', () => {
  it('читает SOAP-ответ: теги DT/Rate и атрибуты DATE/RATE', () => {
    expect(parseKeyRateXml(SOAP_XML)).toEqual([
      { date: '2026-02-16', rate: 15.5 },
      { date: '2026-03-23', rate: 15 },
      { date: '2026-03-24', rate: 15 },
    ]);
    expect(parseKeyRateXml('<KR DATE="2026-07-27T00:00:00+03:00" RATE="14.00"/>')).toEqual([
      { date: '2026-07-27', rate: 14 },
    ]);
  });

  it('читает HTML-таблицу «дата — значение» с запятой в числе', () => {
    const html =
      '<table><tr><td>03.11.2026</td><td>14,00</td></tr><tr><td>27.07.2026</td><td>14,00</td></tr><tr><td>24.07.2026</td><td>14,25</td></tr></table>';

    expect(parseKeyRateHtml(html)).toEqual([
      { date: '2026-11-03', rate: 14 },
      { date: '2026-07-27', rate: 14 },
      { date: '2026-07-24', rate: 14.25 },
    ]);
  });

  it('оставляет только моменты изменения ставки, новые сверху', () => {
    const history = toHistory([
      { date: '2026-02-16', rate: 15.5 },
      { date: '2026-03-23', rate: 15 },
      { date: '2026-03-24', rate: 15 },
    ]);

    expect(history).toEqual([
      { date: '2026-03-23', rate: 15 },
      { date: '2026-02-16', rate: 15.5 },
    ]);
    expect(buildSnapshot(history, 'seed', '2026-11-04T00:00:00Z')?.current.rate).toBe(15);
  });

  it('собирает SOAP-конверт с датами периода', () => {
    const envelope = soapKeyRateEnvelope('2025-01-01', '2026-01-01');
    expect(envelope).toContain('<KeyRateXML xmlns="http://web.cbr.ru/">');
    expect(envelope).toContain('<fromDate>2025-01-01</fromDate>');
  });
});

describe('источник ставки ЦБ', () => {
  const options = (overrides: Partial<Parameters<typeof createCbrSource>[0]> = {}) => ({
    mode: 'live' as const,
    soapUrl: 'https://soap',
    htmlUrl: 'https://html',
    seedFile: seedFile(),
    cache: new KeyRateCache(':memory:', 24),
    now: () => new Date('2026-11-04T12:00:00Z'),
    requestTimeoutMs: 1_000,
    ...overrides,
  });

  it('берёт live-данные через SOAP и кладёт их в кэш', async () => {
    const source = createCbrSource(options({ fetchText: async () => SOAP_XML }));

    const first = await source.read();
    const second = await source.read();

    expect(first?.origin).toBe('live');
    expect(first?.current).toEqual({ date: '2026-03-23', rate: 15 });
    expect(first?.history).toHaveLength(2);
    expect(second?.origin).toBe('cache');
  });

  it('переходит на сид, если SOAP отказал (при пустом кэше)', async () => {
    const source = createCbrSource(
      options({
        fetchText: async (url) => {
          if (url.startsWith('https://soap')) {
            throw new Error('ECONNREFUSED');
          }
          return '<html><table><tr><td>03.11.2026</td><td>14,00</td></tr></table></html>';
        },
      }),
    );

    const snapshot = await source.read();

    expect(snapshot?.origin).toBe('seed');
    expect(snapshot?.current.rate).toBe(14);
  });

  it('берёт HTML-таблицу, если SOAP и сид недоступны', async () => {
    const source = createCbrSource(
      options({
        seedFile: join(tmpdir(), 'нет-такого-сида.json'),
        fetchText: async (url) => {
          if (url.startsWith('https://soap')) {
            throw new Error('ECONNREFUSED');
          }
          return '<table><tr><td>27.07.2026</td><td>14,00</td></tr></table>';
        },
      }),
    );

    const snapshot = await source.read();

    expect(snapshot?.origin).toBe('html');
    expect(snapshot?.current).toEqual({ date: '2026-07-27', rate: 14 });
  });

  it('возвращает undefined в режиме off и не ходит в сеть', async () => {
    let called = false;
    const source = createCbrSource(
      options({
        mode: 'off',
        fetchText: async () => {
          called = true;
          return SOAP_XML;
        },
      }),
    );

    expect(await source.read()).toBeUndefined();
    expect(called).toBe(false);
  });

  it('в режиме seed читает только файл', async () => {
    const source = createCbrSource(options({ mode: 'seed', fetchText: async () => SOAP_XML }));

    const snapshot = await source.read();

    expect(snapshot?.origin).toBe('seed');
    expect(snapshot?.current.rate).toBe(14);
  });

  it('форматирует текст для модели и сообщает об отсутствии данных', async () => {
    const registry = new SourceRegistry([], createCbrSource(options({ fetchText: async () => SOAP_XML })));
    const result = await collectKeyRate(registry);

    expect(formatKeyRate(result)).toContain('Ключевая ставка ЦБ: 15,00 % годовых');

    const empty = await collectKeyRate(new SourceRegistry());
    expect(formatKeyRate(empty)).toContain('Ключевая ставка недоступна');
  });
});
