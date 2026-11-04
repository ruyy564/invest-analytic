import { APPROVAL_RULES } from '../../src/agent/approvals/approval-rules.js';
import { fakeTool } from './fake-mcp-tools.js';
import { ACCOUNTS_FIXTURE, PORTFOLIO_FIXTURE } from './mcp-test-server.js';

/**
 * Данные для разбора: два класса активов, цены, прогноз, новости и налоги.
 * Формы повторяют ответы Tinkoff MCP (строковые числа, `balance` у позиций).
 */
export const POSITIONS_JSON = {
  securities: [
    { balance: '100', ticker: 'SBER', classCode: 'TQBR', instrumentUid: 'uid-sber' },
    { balance: '10', ticker: 'SU26238', classCode: 'TQCB', instrumentUid: 'uid-ofz' },
  ],
  money: [{ currency: 'rub', value: '1000' }],
};

export const MARKET_VALUES_JSON = {
  instruments: [
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [
        { type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '294.55' } },
      ],
    },
    {
      ticker: 'SU26238',
      classCode: 'TQCB',
      priceCurrency: 'rub',
      values: [
        { type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '900' } },
      ],
    },
  ],
};

export const FORECAST_JSON = {
  consensus: {
    ticker: 'SBER',
    recommendation: 'RECOMMENDATION_BUY',
    consensus: { value: '382.37' },
    minTarget: { value: '320' },
    maxTarget: { value: '430' },
    currentPrice: { value: '294.55' },
    priceChangeRel: { value: '29.8' },
  },
};

export const NEWS_JSON = {
  items: [
    {
      id: 'news-1',
      title: 'Сбербанк отчитался за квартал',
      content: 'Чистая прибыль выросла',
      ts: '2026-11-04T09:00:00Z',
      source: 'interfax',
    },
  ],
  hasNext: false,
};

export const OPERATIONS_JSON = {
  operations: [
    {
      operationType: 'OPERATION_TYPE_TAX',
      payment: { currency: 'rub', value: '-1234.5' },
      date: '2026-06-01T00:00:00Z',
    },
    {
      operationType: 'OPERATION_TYPE_DIVIDEND_TAX',
      payment: { currency: 'rub', value: '-345.5' },
      date: '2026-07-01T00:00:00Z',
    },
  ],
};

const DEFAULTS: Record<string, unknown> = {
  invest_list_accounts: ACCOUNTS_FIXTURE,
  invest_get_portfolio: PORTFOLIO_FIXTURE,
  invest_get_positions: POSITIONS_JSON,
  invest_get_market_values: MARKET_VALUES_JSON,
  // Справочник актива: сектор приходит в brand.sector (enum T-Invest).
  invest_get_asset: { uid: 'uid-sber', brand: { uid: 'brand-sber', sector: 'SECTOR_FINANCIAL' } },
  invest_get_forecast: FORECAST_JSON,
  // Поиск бумаги и свечи: динамика считается по дневным свечам.
  invest_find_instrument: {
    instruments: [{ ticker: 'SBER', classCode: 'TQBR', name: 'Сбербанк' }],
  },
  invest_get_candles: {
    priceCurrency: 'rub',
    candles: [
      { time: '2026-05-04T00:00:00Z', close: { value: '250' } },
      { time: '2026-08-04T00:00:00Z', close: { value: '270' } },
      { time: '2026-11-04T00:00:00Z', close: { value: '294.55' } },
    ],
  },
  invest_get_news: NEWS_JSON,
  invest_get_operations: OPERATIONS_JSON,
  invest_get_share_dividends: { dividends: [] },
  invest_get_asset_fundamentals: { fundamental: {} },
  invest_list_signals: { signals: [] },
  invest_list_indicatives: { instruments: [] },
};

/** Имена инструментов e2e: фикстуры + всё, на что ссылаются правила подтверждений. */
export const E2E_TOOL_NAMES: string[] = [
  ...new Set<string>([
    ...Object.keys(DEFAULTS),
    ...APPROVAL_RULES.map((rule) => rule.tool)
      .filter((name) => name.startsWith('tinkoff__'))
      .map((name) => name.replace('tinkoff__', '')),
  ]),
];

/** Allowlist для тестового окружения: совпадает с каталогом фикстур. */
export const E2E_ALLOWED_TOOLS = E2E_TOOL_NAMES.join(',');

/**
 * Каталог инструментов для e2e. Данные — фикстуры выше, сеть не нужна.
 */
export const e2eToolCatalog = (
  overrides: Record<string, () => unknown> = {},
): ReturnType<typeof fakeTool>[] =>
  E2E_TOOL_NAMES.map((name) =>
    fakeTool(name, overrides[name] ?? (async () => DEFAULTS[name] ?? {})),
  );
