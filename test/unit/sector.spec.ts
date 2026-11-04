import { join } from 'node:path';
import { buildCollectionPlan, planKey, sectorEntries } from '../../src/collection/plan.js';
import { buildReport } from '../../src/report/engine.js';
import { createProviderMap } from '../../src/report/providers/index.js';
import { sectorByTicker, sectorLabel, sectorOf, UNKNOWN_SECTOR } from '../../src/report/sector.js';
import { loadReportTemplate } from '../../src/report/template.js';
import { POSITIONS_JSON } from '../fixtures/e2e-catalog.js';

const templatePath = join(import.meta.dirname, '..', '..', 'reports', 'portfolio-review.yaml');

const ASSET_SBER = {
  uid: 'uid-sber',
  brand: { uid: 'brand-sber', name: 'Сбербанк', sector: 'SECTOR_FINANCIAL' },
};

const ASSET_OFZ = {
  uid: 'uid-ofz',
  brand: { uid: 'brand-ofz', sector: 'SECTOR_OTHER' },
};

const MARKET_VALUES = {
  instruments: [
    {
      ticker: 'SBER',
      classCode: 'TQBR',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '300' } }],
    },
    {
      ticker: 'SU26238',
      classCode: 'TQCB',
      priceCurrency: 'rub',
      values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '900' } }],
    },
  ],
};

describe('определение сектора бумаги', () => {
  it('читает сектор из brand.sector, вложенного и корневого вида', () => {
    expect(sectorOf(ASSET_SBER)).toBe('SECTOR_FINANCIAL');
    expect(sectorOf({ asset: ASSET_SBER })).toBe('SECTOR_FINANCIAL');
    expect(sectorOf({ asset: { brand: { sector: 'SECTOR_IT' } } })).toBe('SECTOR_IT');
    expect(sectorOf({ sector: 'SECTOR_ENERGY' })).toBe('SECTOR_ENERGY');
  });

  it('не считает сектором пустое значение и SECTOR_UNSPECIFIED', () => {
    expect(sectorOf({ brand: { sector: 'SECTOR_UNSPECIFIED' } })).toBeUndefined();
    expect(sectorOf({ brand: {} })).toBeUndefined();
    expect(sectorOf(undefined)).toBeUndefined();
  });

  it('переводит enum в русское название и сохраняет неизвестные значения', () => {
    expect(sectorLabel('SECTOR_FINANCIAL')).toBe('финансы');
    expect(sectorLabel('SECTOR_IT')).toBe('информационные технологии');
    expect(sectorLabel('SECTOR_NEW')).toBe('SECTOR_NEW');
    expect(sectorLabel(undefined)).toBe(UNKNOWN_SECTOR);
    expect(sectorLabel('SECTOR_UNSPECIFIED')).toBe(UNKNOWN_SECTOR);
  });

  it('собирает карту «тикер → сектор» и пропускает битые ответы', () => {
    const map = sectorByTicker([
      { target: 'SBER', text: JSON.stringify(ASSET_SBER) },
      { target: 'BROKEN', text: 'не json' },
      { target: undefined, text: JSON.stringify(ASSET_OFZ) },
    ]);

    expect([...map.entries()]).toEqual([['SBER', 'финансы']]);
  });

  it('строит записи справочника актива по uid', () => {
    const entries = sectorEntries([
      { ticker: 'SBER', classCode: 'TQBR', uid: 'uid-sber' },
      { ticker: 'NOUID' },
    ]);

    expect(entries).toEqual([
      {
        tool: 'invest_get_asset',
        args: { instrumentId: 'uid-sber', idType: 'INSTRUMENT_ID_TYPE_UID' },
        group: 'reference',
        priority: 'optional',
        target: 'SBER',
      },
    ]);
  });
});

describe('сектор в отчёте', () => {
  const buildWithSectors = () => {
    const plan = buildCollectionPlan({
      accounts: ['acc-1'],
      tickers: ['SBER', 'SU26238'],
      maxInstruments: 15,
      providers: ['portfolio.structure', 'portfolio.gaps'],
    });
    plan.entries.push(
      ...sectorEntries([{ ticker: 'SBER', classCode: 'TQBR', uid: 'uid-sber' }]),
    );

    const results = new Map<string, string>();
    for (const entry of plan.entries) {
      if (entry.tool === 'invest_get_positions') {
        results.set(planKey(entry), JSON.stringify(POSITIONS_JSON));
      }
      if (entry.tool === 'invest_get_portfolio') {
        results.set(planKey(entry), JSON.stringify({ totalAmountCurrencies: [{ currency: 'rub' }] }));
      }
      if (entry.tool === 'invest_get_market_values') {
        results.set(planKey(entry), JSON.stringify(MARKET_VALUES));
      }
      if (entry.tool === 'invest_get_asset') {
        results.set(planKey(entry), JSON.stringify(ASSET_SBER));
      }
    }

    return buildReport({
      template: loadReportTemplate(templatePath),
      providers: createProviderMap(),
      plan,
      collected: { results, coverage: [], partial: false },
      reportId: 'report-sector',
    });
  };

  it('разрез по секторам берёт сектор из справочника', () => {
    const structure = buildWithSectors().sections.find((section) => section.id === 'structure');

    expect(structure?.markdown).toContain('финансы');
    // Вторая бумага сектора не получила — честно помечена.
    expect(structure?.markdown).toContain(UNKNOWN_SECTOR);
  });

  it('пробелы сообщают долю портфеля без определённого сектора', () => {
    const gaps = buildWithSectors().sections.find((section) => section.id === 'gaps');

    expect(gaps?.markdown).toContain('сектор не определён');
    expect(gaps?.markdown).toContain('справочник активов не дал сектор');
  });
});
