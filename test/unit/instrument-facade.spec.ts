import { pickBestInstrument } from '../../src/capabilities/instruments/tools/facade.js';
import { createInstrumentTools, formatForecast } from '../../src/capabilities/instruments/tools/instruments.tools.js';
import { McpRateLimitedError } from '../../src/transports/mcp/errors.js';
import { fakeTool } from '../fixtures/fake-mcp-tools.js';

const item = (record: Record<string, unknown>) => record;

describe('выбор инструмента из результатов поиска', () => {
  it('акция важнее облигации с тем же названием', () => {
    // «Сегежа» возвращает облигации и акцию: отвечать нужно про акцию SGZH,
    // а не про «Сегежа 003P-04R».
    const raw = {
      instruments: [
        item({ ticker: 'RU000A108991', classCode: 'TQCB', name: 'Сегежа 003P-04R', instrumentKind: 'INSTRUMENT_TYPE_BOND' }),
        item({ ticker: 'SGZH', classCode: 'TQBR', name: 'Сегежа', instrumentKind: 'INSTRUMENT_TYPE_SHARE' }),
      ],
    };

    expect(pickBestInstrument(raw, 'сегежа')).toMatchObject({ ticker: 'SGZH' });
  });

  it('точный тикер важнее вида инструмента', () => {
    // Запрос по тикеру фьючерса должен вернуть фьючерс, а не акцию.
    const raw = {
      instruments: [
        item({ ticker: 'SGZH', classCode: 'TQBR', name: 'Сегежа', instrumentKind: 'INSTRUMENT_TYPE_SHARE' }),
        item({ ticker: 'SZH4', classCode: 'SPBFUT', name: 'SGZH-3.24 Сегежа', instrumentKind: 'INSTRUMENT_TYPE_FUTURES' }),
      ],
    };

    expect(pickBestInstrument(raw, 'SZH4')).toMatchObject({ ticker: 'SZH4' });
  });

  it('пустой ответ не ломает поиск', () => {
    expect(pickBestInstrument({ instruments: [] }, 'сегежа')).toBeUndefined();
    expect(pickBestInstrument(undefined, 'сегежа')).toBeUndefined();
  });
});

describe('фасад цены и лимит частоты брокера', () => {
  const FIND = JSON.stringify({
    instruments: [
      { ticker: 'SBER', classCode: 'TQBR', name: 'Сбербанк', instrumentKind: 'INSTRUMENT_TYPE_SHARE' },
    ],
  });
  const VALUES = JSON.stringify({
    instruments: [
      {
        ticker: 'SBER',
        classCode: 'TQBR',
        priceCurrency: 'rub',
        values: [
          {
            type: 'INSTRUMENT_VALUE_LAST_PRICE',
            value: { value: '250.50', currency: 'rub' },
          },
        ],
      },
    ],
  });

  /** Стенд фасада: считает обращения к MCP и умеет включать 429. */
  const harness = (now: () => number = () => Date.now()) => {
    let calls = 0;
    let failing = false;
    const tools = new Map([
      ['invest_find_instrument', fakeTool('invest_find_instrument', async () => FIND)],
      [
        'invest_get_market_values',
        fakeTool('invest_get_market_values', async () => {
          calls += 1;
          if (failing) {
            throw new McpRateLimitedError();
          }
          return VALUES;
        }),
      ],
    ]);
    const prices = createInstrumentTools({
      lookup: (name) => tools.get(name),
      timeoutMs: 1000,
      priceCacheTtlMs: 30_000,
      now,
    }).find((tool) => tool.name === 'instruments__prices');

    return {
      prices: prices!,
      calls: () => calls,
      fail: (value: boolean) => {
        failing = value;
      },
    };
  };

  it('держит цену в кэше и не ходит в MCP повторно в пределах TTL', async () => {
    let clock = 1_000;
    const stand = harness(() => clock);

    const first = await stand.prices.invoke({ ticker: 'SBER' } as never);
    clock += 5_000;
    const second = await stand.prices.invoke({ ticker: 'SBER' } as never);

    expect(String(first)).toContain('250.50');
    expect(String(second)).toBe(String(first));
    expect(stand.calls()).toBe(1);
  });

  it('при 429 отдаёт последнюю цену с временем вместо отказа', async () => {
    let clock = 1_000;
    const stand = harness(() => clock);
    await stand.prices.invoke({ ticker: 'SBER' } as never);

    stand.fail(true);
    clock += 60_000; // кэш протух: идём в MCP и получаем лимит частоты
    const text = String(await stand.prices.invoke({ ticker: 'SBER' } as never));

    expect(text).toContain('250.50');
    expect(text).toContain('ограничил частоту');
    expect(stand.calls()).toBe(2);
  });

  it('без сохранённой цены 429 даёт понятный текст, а не ошибку', async () => {
    const stand = harness();
    stand.fail(true);

    const text = String(await stand.prices.invoke({ ticker: 'SBER' } as never));

    expect(text).toContain('временно недоступна');
  });
});

describe('прогноз аналитиков', () => {
  it('читает вложенные поля MCP и переводит рекомендацию', () => {
    // Реальный ответ invest_get_forecast: значения лежат в `{ value }`, а не плоско.
    const text = formatForecast({
      consensus: {
        ticker: 'SBER',
        recommendation: 'RECOMMENDATION_BUY',
        currency: '',
        currentPrice: { value: '293.71' },
        consensus: { value: '383.8' },
        minTarget: { value: '320' },
        maxTarget: { value: '430' },
        priceChangeRel: { value: '30.67' },
      },
    });

    expect(text).toContain('покупать');
    expect(text).toContain('383.8');
    expect(text).toContain('320–430');
    expect(text).toContain('30.67%');
  });

  it('без прогноза честно сообщает об отсутствии', () => {
    expect(formatForecast('{}')).toBe('прогноза аналитиков нет');
    expect(formatForecast(undefined)).toBe('прогноза аналитиков нет');
  });
});
