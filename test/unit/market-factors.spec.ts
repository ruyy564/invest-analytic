import { createFactorsTool } from '../../src/capabilities/market/tools/factors/factors.tool.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const NOW = '2026-11-07T10:00:00.000Z';
const iso = (daysAgo: number): string =>
  new Date(Date.parse(NOW) - daysAgo * 24 * 60 * 60 * 1000).toISOString();

const candlesOf = (currency: string, from: string, to: string) => ({
  priceCurrency: currency,
  candles: [
    { time: iso(30), close: { value: from } },
    { time: iso(0), close: { value: to } },
  ],
});

/** Схема тестового инструмента пустая, поэтому аргументы до `func` не доходят:
 *  нужное значение задаём фикстурой на каждый инструмент отдельно. */
const buildTool = (candles: { currency: string; from: string; to: string }) => {
  const tools = new Map([
    [
      'invest_get_candles',
      fakeTool('invest_get_candles', async () => candlesOf(candles.currency, candles.from, candles.to)),
    ],
    ['invest_get_market_values', fakeTool('invest_get_market_values', async () => ({ instruments: [] }))],
  ]);
  return createFactorsTool({
    tool: (name) => tools.get(name),
    timeoutMs: 100,
    keyRate: {
      id: 'cbr',
      read: async () => ({
        current: { date: '2026-10-24', rate: 16.5 },
        history: [],
        origin: 'seed',
        asOf: NOW,
      }),
    },
  });
};

describe('рыночные факторы числами', () => {
  it('показывает значение, изменение и ставку', async () => {
    const answer = String(
      await buildTool({ currency: 'usd', from: '98.5', to: '98.64' }).invoke({ days: 30 }),
    );

    expect(answer).toContain('Рыночные факторы за 30 дн.');
    expect(answer).toContain('Нефть Brent: 98,64 USD за баррель');
    expect(answer).toContain('+0,14 %');
    expect(answer).toContain('Ключевая ставка ЦБ: 16,50 % годовых');
    expect(answer).toContain('действует с 2026-10-24');
  });

  it('считает изменение по валюте', async () => {
    const answer = String(
      await buildTool({ currency: 'rub', from: '85.42', to: '82.14' }).invoke({ days: 30 }),
    );

    expect(answer).toContain('Доллар/рубль: 82,14 RUB');
    expect(answer).toContain('-3,84 %');
  });

  it('без данных говорит об этом прямо', async () => {
    const answer = String(
      await createFactorsTool({ tool: () => undefined, timeoutMs: 100 }).invoke({ days: 30 }),
    );

    expect(answer).toBe(
      'Рыночные факторы недоступны: котировки нефти, валют и ставки не получены.',
    );
  });
});
