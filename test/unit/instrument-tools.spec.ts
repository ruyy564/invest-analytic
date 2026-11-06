import { createInstrumentTools, INSTRUMENT_TOOLS } from '../../src/capabilities/instruments/tools/instruments.tools.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const findResponse = {
  instruments: [
    { ticker: 'SBER', classCode: 'TQBR', name: 'Сбербанк', instrumentType: 'share' },
  ],
};

const marketValues = {
  instruments: [
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [
        { type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '294.55' } },
      ],
    },
  ],
};

const tools = (overrides: Record<string, unknown> = {}) => {
  const map = new Map<string, ReturnType<typeof fakeTool>>();
  const impl = (name: string, fallback: unknown) =>
    fakeTool(name, async () => (name in overrides ? overrides[name] : fallback));

  map.set('invest_find_instrument', impl('invest_find_instrument', findResponse));
  map.set('invest_get_market_values', impl('invest_get_market_values', marketValues));
  map.set('invest_get_forecast', impl('invest_get_forecast', { targetPrice: 382, priceChange: 30.6 }));
  map.set(
    'invest_get_share_dividends',
    impl('invest_get_share_dividends', { dividendNet: 33.3, lastBuyDate: '2026-12-09' }),
  );
  map.set('invest_get_share', impl('invest_get_share', { sector: 'financial', name: 'Сбербанк' }));
  map.set('invest_get_candles', impl('invest_get_candles', { candles: [{ close: 294.55, high: 300 }] }));

  return createInstrumentTools({ lookup: (name) => map.get(name), timeoutMs: 500 });
};

const byName = (list: ReturnType<typeof tools>, name: string) => {
  const tool = list.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`нет тула ${name}`);
  }
  return tool;
};

describe('доменные фасады бумаг', () => {
  it('создаёт шесть фасадов с понятными именами', () => {
    const list = tools();

    expect(list.map((tool) => tool.name)).toEqual([
      INSTRUMENT_TOOLS.find,
      INSTRUMENT_TOOLS.prices,
      INSTRUMENT_TOOLS.candles,
      INSTRUMENT_TOOLS.forecast,
      INSTRUMENT_TOOLS.dividends,
      INSTRUMENT_TOOLS.meta,
    ]);
  });

  it('цена: находит класс и возвращает компактную строку', async () => {
    const list = tools();

    const result = await byName(list, INSTRUMENT_TOOLS.prices).invoke({ ticker: 'SBER' });

    expect(String(result)).toBe('цена за 1 шт.: 294.55 RUB');
  });

  it('прогноз и дивиденды: только ключевые поля', async () => {
    const list = tools();

    const forecast = await byName(list, INSTRUMENT_TOOLS.forecast).invoke({ ticker: 'SBER' });
    const dividends = await byName(list, INSTRUMENT_TOOLS.dividends).invoke({ ticker: 'SBER' });

    expect(String(forecast)).toContain('targetPrice: 382');
    expect(String(dividends)).toContain('lastBuyDate: 2026-12-09');
    expect(String(dividends)).not.toContain('{');
  });

  it('справочник отдаёт сектор', async () => {
    const list = tools();

    const meta = await byName(list, INSTRUMENT_TOOLS.meta).invoke({ ticker: 'SBER' });

    expect(String(meta)).toContain('sector: financial');
  });

  it('неизвестная бумага даёт понятную ошибку', async () => {
    const list = tools({ invest_find_instrument: { instruments: [] } });

    await expect(byName(list, INSTRUMENT_TOOLS.prices).invoke({ ticker: 'XXXX' })).rejects.toThrow(
      'не найдена',
    );
  });

  it('недоступный инструмент брокера не маскируется', async () => {
    const list = createInstrumentTools({ lookup: () => undefined, timeoutMs: 100 });

    await expect(byName(list, INSTRUMENT_TOOLS.find).invoke({ query: 'SBER' })).rejects.toThrow(
      'invest_find_instrument недоступен',
    );
  });
});
