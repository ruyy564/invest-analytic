import { McpInvalidResponseError } from '../../src/tools/errors.js';
import { mapInstrument } from '../../src/tools/mappers/instrument.mapper.js';
import { normalizeCurrency, parseDecimal, parseMoney } from '../../src/tools/mappers/money.js';
import { mapPortfolio } from '../../src/tools/mappers/portfolio.mapper.js';
import { mapPositions } from '../../src/tools/mappers/positions.mapper.js';
import { mapMarketValues, priceOf } from '../../src/tools/mappers/market-values.mapper.js';

const PORTFOLIO = {
  accountId: 'acc-1',
  currency: 'rub',
  totalValue: { value: '152345.67', currency: 'rub' },
  expectedYield: { value: '12345.67', currency: 'rub' },
  time: '2026-10-29T15:47:13Z',
  positions: [
    {
      instrumentUid: 'uid-1',
      positionUid: 'pos-1',
      ticker: 'SBER',
      name: 'Сбербанк',
      quantity: { value: '100' },
      currentPrice: { value: '294.55', currency: 'rub' },
      positionValue: { value: '29455.00', currency: 'rub' },
    },
    {
      instrumentUid: 'uid-2',
      positionUid: 'pos-2',
      ticker: 'GAZP',
      name: 'Газпром',
      quantity: { value: '250' },
    },
  ],
};

describe('деньги из ответов MCP', () => {
  it('строго разбирает десятичные строки', () => {
    expect(parseDecimal('294.55')).toBe(294.55);
    expect(parseDecimal('-10')).toBe(-10);
    expect(() => parseDecimal('abc')).toThrow(McpInvalidResponseError);
  });

  it('нормализует код валюты и различает пункты', () => {
    expect(normalizeCurrency('rub')).toBe('RUB');
    expect(normalizeCurrency('')).toBe('RUB');
    expect(normalizeCurrency('pt')).toBe('pt');

    expect(parseMoney({ value: '10', currency: 'rub' }, 'rub')).toEqual({
      amount: 10,
      currency: 'RUB',
      raw: '10',
      isPoints: false,
    });
    expect(parseMoney({ value: '10', currency: 'pt' }, 'rub')?.isPoints).toBe(true);
    expect(parseMoney(undefined, 'rub')).toBeUndefined();
  });
});

describe('маппер бумаги', () => {
  it('различает uid бумаги и positionUid', () => {
    const instrument = mapInstrument({ uid: 'uid-1', positionUid: 'pos-1', ticker: 'sber', name: 'Сбербанк' });

    expect(instrument).toMatchObject({ uid: 'uid-1', positionUid: 'pos-1', ticker: 'SBER' });
  });

  it('падает без обязательных полей', () => {
    expect(() => mapInstrument({ uid: 'uid-1' })).toThrow(McpInvalidResponseError);
  });
});

describe('маппер портфеля', () => {
  it('переносит позиции, итоги и время данных', () => {
    const portfolio = mapPortfolio(PORTFOLIO);

    expect(portfolio.currency).toBe('RUB');
    expect(portfolio.totalValue).toMatchObject({ amount: 152345.67, currency: 'RUB' });
    expect(portfolio.expectedYield?.amount).toBe(12345.67);
    expect(portfolio.positions).toHaveLength(2);
    expect(portfolio.positions[0]).toMatchObject({
      instrument: { ticker: 'SBER', positionUid: 'pos-1' },
      quantity: { amount: 100 },
      currentPrice: { amount: 294.55, currency: 'RUB' },
    });
    expect(portfolio.positions[1]?.currentPrice).toBeUndefined();
    expect(portfolio.dataAsOf).toBe('2026-10-29T15:47:13Z');
  });

  it('не выдумывает данные при пустом портфеле', () => {
    const portfolio = mapPortfolio({ currency: 'rub' });

    expect(portfolio.positions).toEqual([]);
    expect(portfolio.totalValue).toBeUndefined();
    expect(portfolio.expectedYield).toBeUndefined();
  });

  it('читает итог из totalAmountPortfolio (текущий формат API)', () => {
    const portfolio = mapPortfolio({
      totalAmountPortfolio: { currency: 'rub', value: '237100.43' },
      expectedYield: { value: '11.59' },
    });

    expect(portfolio.totalValue).toMatchObject({ amount: 237100.43, currency: 'RUB' });
    expect(portfolio.expectedYield?.amount).toBe(11.59);
  });

  it('помечает состав недоступным, если стоимость есть, а позиций в ответе нет', () => {
    // Так ведёт себя invest_get_portfolio: только итоги, без массива positions.
    const portfolio = mapPortfolio({ totalAmountPortfolio: { currency: 'rub', value: '237100.43' } });

    expect(portfolio.positions).toEqual([]);
    expect(portfolio.positionsUnavailable).toBe(true);
  });

  it('падает на некорректном ответе', () => {
    expect(() => mapPortfolio('строкой')).toThrow(McpInvalidResponseError);
  });
});

describe('маппер цен (invest_get_market_values)', () => {
  const RAW = {
    instruments: [
      {
        ticker: 'SBER',
        classCode: 'TQBR',
        priceCurrency: 'rub',
        values: [
          { type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { value: '296.70' } },
          { type: 'INSTRUMENT_VALUE_CLOSE_PRICE', value: { value: '290.10' } },
        ],
      },
      {
        ticker: 'Si',
        classCode: 'SPBFUT',
        priceCurrency: 'pt',
        values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { value: '85000' } }],
      },
    ],
  };

  it('берёт последнюю цену и валюту инструмента', () => {
    const prices = mapMarketValues(RAW);

    expect(priceOf(prices, 'SBER', 'TQBR')).toMatchObject({ amount: 296.7, currency: 'RUB' });
    expect(priceOf(prices, 'sber')).toMatchObject({ amount: 296.7 });
    // Фьючерсы котируются в пунктах — их нельзя подписывать как рубли.
    expect(priceOf(prices, 'Si', 'SPBFUT')?.isPoints).toBe(true);
  });

  it('понимает ответ адаптера MCP — JSON-строку', () => {
    expect(priceOf(mapMarketValues(JSON.stringify(RAW)), 'SBER', 'TQBR')?.amount).toBe(296.7);
  });

  it('падает, если ответ не разбирается', () => {
    expect(() => mapMarketValues('не json')).toThrow();
  });
});

describe('маппер позиций (invest_get_positions)', () => {
  const POSITIONS = {
    money: [{ currency: 'rub', value: '958.08' }],
    blocked: [],
    securities: [
      { blocked: '0', balance: '19', ticker: 'NVTK', classCode: 'TQBR' },
      { blocked: '0', balance: '77', ticker: 'SBER', classCode: 'TQBR' },
    ],
    futures: [{ balance: '2', ticker: 'Si-12.25' }],
    options: [],
  };

  it('берёт бумаги, фьючерсы и опционы; цены не выдумывает', () => {
    const positions = mapPositions(POSITIONS);

    expect(positions.map((position) => position.instrument.ticker)).toEqual([
      'NVTK',
      'SBER',
      'SI-12.25',
    ]);
    expect(positions[0]).toMatchObject({
      quantity: { amount: 19, currency: 'RUB' },
      currentPrice: undefined,
      positionValue: undefined,
    });
  });

  it('понимает ответ адаптера MCP — JSON-строку', () => {
    expect(mapPositions(JSON.stringify(POSITIONS))).toHaveLength(3);
  });

  it('падает, если ответ не разбирается', () => {
    expect(() => mapPositions('не json')).toThrow(McpInvalidResponseError);
  });
});
