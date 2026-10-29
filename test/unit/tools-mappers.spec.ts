import { McpInvalidResponseError } from '../../src/tools/errors.js';
import { mapInstrument } from '../../src/tools/mappers/instrument.mapper.js';
import { normalizeCurrency, parseDecimal, parseMoney } from '../../src/tools/mappers/money.js';
import { mapPortfolio } from '../../src/tools/mappers/portfolio.mapper.js';

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

  it('падает на некорректном ответе', () => {
    expect(() => mapPortfolio('строкой')).toThrow(McpInvalidResponseError);
  });
});
