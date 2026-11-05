import { join } from 'node:path';
import { buildCollectionPlan, planKey } from '../../src/collection/plan.js';
import { assetEntries, brandEntries, shareEntries } from '../../src/collection/reference.js';
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
    expect(sectorLabel('SECTOR_ENERGY')).toBe('нефть и газ');
    // Коммунальные услуги и электроэнергетика — разные секторы: путать нельзя.
    expect(sectorLabel('SECTOR_UTILITIES')).toBe('электроэнергетика');
    expect(sectorLabel('green_energy')).toBe('зелёная энергетика');
    expect(sectorLabel('SECTOR_IT')).toBe('технологии');
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

  it('строит первый шаг справочника: бумага → uid актива', () => {
    const entries = shareEntries([
      { ticker: 'SBER', classCode: 'TQBR' },
      { ticker: 'SU26238', classCode: 'TQCB' },
    ]);

    expect(entries[0]).toEqual({
      tool: 'invest_get_share',
      // uid актива приходит только с `responseView: FULL`.
      args: {
        instrumentId: 'SBER_TQBR',
        idType: 'INSTRUMENT_ID_TYPE_ID',
        responseView: ['FULL'],
      },
      group: 'reference',
      priority: 'optional',
      target: 'SBER',
    });
    expect(entries).toHaveLength(2);
  });

  it('достаёт сектор бренда из цепочки share → asset → brand', () => {
    const shares = shareEntries([{ ticker: 'SBER', classCode: 'TQBR' }]);
    const shareTexts = new Map([
      [
        planKey(shares[0]),
        JSON.stringify({ instrument: { ticker: 'SBER', classCode: 'TQBR', assetUid: 'asset-1' } }),
      ],
    ]);
    const assets = assetEntries(shares, shareTexts, planKey);

    expect(assets[0]?.tool).toBe('invest_get_asset');
    expect(assets[0]?.args).toEqual({ id: 'asset-1' });

    const assetTexts = new Map([
      [planKey(assets[0]), JSON.stringify({ asset: { uid: 'asset-1', brand: { uid: 'brand-1' } } })],
    ]);
    const brands = brandEntries(assets, assetTexts, planKey);

    expect(brands[0]?.tool).toBe('invest_get_brand');
    expect(brands[0]?.args).toEqual({ id: 'brand-1' });
    // Бренд отдаёт сектор строкой — приводим к русскому названию.
    expect(sectorByTicker([{ target: 'SBER', text: JSON.stringify({ sector: 'financial' }) }])).toEqual(
      new Map([['SBER', 'финансы']]),
    );
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
    // Справочник секторов: share → asset → brand.
    const shares = shareEntries([{ ticker: 'SBER', classCode: 'TQBR' }]);
    const shareTexts = new Map([
      [planKey(shares[0]), JSON.stringify({ instrument: { assetUid: 'uid-sber' } })],
    ]);
    const assets = assetEntries(shares, shareTexts, planKey);
    const assetTexts = new Map([[planKey(assets[0]), JSON.stringify(ASSET_SBER)]]);
    const brands = brandEntries(assets, assetTexts, planKey);
    plan.entries.push(...shares, ...assets, ...brands);

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
      if (entry.tool === 'invest_get_share') {
        results.set(planKey(entry), JSON.stringify({ instrument: { assetUid: 'uid-sber' } }));
      }
      if (entry.tool === 'invest_get_asset') {
        results.set(planKey(entry), JSON.stringify(ASSET_SBER));
      }
      if (entry.tool === 'invest_get_brand') {
        results.set(planKey(entry), JSON.stringify({ sector: 'financial' }));
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
