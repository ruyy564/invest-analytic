import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
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
  map.set('invest_get_forecast', impl('invest_get_forecast', {
    consensus: {
      ticker: 'SBER',
      recommendation: 'RECOMMENDATION_BUY',
      currency: 'rub',
      consensus: { value: '383.8' },
      minTarget: { value: '320' },
      maxTarget: { value: '430' },
      priceChangeRel: { value: '30.67' },
    },
  }));
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

    expect(String(forecast)).toContain('покупать');
    expect(String(forecast)).toContain('цель аналитиков: 383.8');
    expect(String(forecast)).toContain('потенциал: 30.67%');
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

describe('аргументы фасадов совпадают со схемами MCP', () => {
  // Регрессия живого прогона: брокер отклонил `instrumentIds`, `interval: 1d`
  // и вызов без `idType`, модель зациклилась на повторных подтверждениях.
  const recorder = () => {
    const calls = new Map<string, unknown[]>();
    const tool = (name: string, response: unknown) =>
      new DynamicStructuredTool({
        name,
        description: `${name} — записывает аргументы`,
        schema: z.object({}).passthrough(),
        func: async (input: unknown) => {
          calls.set(name, [...(calls.get(name) ?? []), input]);
          return response;
        },
      } as never);
    const list = createInstrumentTools({
      lookup: (name) =>
        name === 'invest_find_instrument'
          ? tool(name, findResponse)
          : name === 'invest_get_market_values'
            ? tool(name, marketValues)
            : name === 'invest_get_share'
              ? tool(name, { sector: 'financial' })
              : tool(name, { candles: [], targetPrice: 382 }),
      timeoutMs: 500,
    });
    return { calls, list };
  };

  it('цена: массив `instrumentId`, а не `instrumentIds`', async () => {
    const { calls, list } = recorder();

    await byName(list, INSTRUMENT_TOOLS.prices).invoke({ ticker: 'SBER' });

    expect(calls.get('invest_get_market_values')).toEqual([{ instrumentId: ['SBER_TQBR'] }]);
  });

  it('свечи: интервал из перечисления MCP', async () => {
    const { calls, list } = recorder();

    await byName(list, INSTRUMENT_TOOLS.candles).invoke({ ticker: 'SBER' });

    expect(calls.get('invest_get_candles')?.[0]).toMatchObject({
      instrumentId: 'SBER_TQBR',
      interval: 'CANDLE_INTERVAL_DAY',
    });
  });

  it('справочник: обязательный `idType`', async () => {
    const { calls, list } = recorder();

    await byName(list, INSTRUMENT_TOOLS.meta).invoke({ ticker: 'SBER' });

    expect(calls.get('invest_get_share')?.[0]).toMatchObject({
      instrumentId: 'SBER_TQBR',
      idType: 'INSTRUMENT_ID_TYPE_ID',
    });
  });

  it('одноимённые инструменты: выбирается акция основного режима', async () => {
    const manySameTicker = {
      instruments: [
        // Так отвечает брокер: тикер SBER носят и внебиржевые режимы, и основной TQBR.
        { ticker: 'SBER', classCode: '37M', name: 'Сбербанк', instrumentKind: 'INSTRUMENT_TYPE_SHARE' },
        { ticker: 'SBER', classCode: 'SMAL', name: 'Сбербанк', instrumentKind: 'INSTRUMENT_TYPE_SHARE' },
        { ticker: 'SBER', classCode: 'TQBR', name: 'Сбербанк', instrumentKind: 'INSTRUMENT_TYPE_SHARE' },
      ],
    };
    const calls = new Map<string, unknown[]>();
    const tool = (name: string, response: unknown) =>
      new DynamicStructuredTool({
        name,
        description: name,
        schema: z.object({}).passthrough(),
        func: async (input: unknown) => {
          calls.set(name, [...(calls.get(name) ?? []), input]);
          return response;
        },
      } as never);
    const list = createInstrumentTools({
      lookup: (name) =>
        name === 'invest_find_instrument'
          ? tool(name, manySameTicker)
          : name === 'invest_get_market_values'
            ? tool(name, marketValues)
            : tool(name, {}),
      timeoutMs: 500,
    });

    await byName(list, INSTRUMENT_TOOLS.prices).invoke({ ticker: 'SBER' });

    expect(calls.get('invest_get_market_values')).toEqual([{ instrumentId: ['SBER_TQBR'] }]);
  });
});
