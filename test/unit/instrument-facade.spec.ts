import { pickBestInstrument } from '../../src/capabilities/instruments/tools/facade.js';

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
