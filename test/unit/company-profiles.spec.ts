import { readFileSync } from 'node:fs';
import {
  EMPTY_PROFILES,
  EXPOSURE_LABELS,
  companyProfileOf,
  exposureOf,
  loadCompanyProfiles,
  parseCompanyProfiles,
  sectorProfileOf,
  sensitivityWord,
} from '../../src/report/company-profiles.js';

const FILE = parseCompanyProfiles({
  version: 1,
  sectors: [
    { key: 'energy', drivers: ['цена нефти', 'курс рубля'], currency: 'positive', rate: 'negative' },
    { key: 'financial', drivers: ['ключевая ставка'], currency: 'neutral', rate: 'positive' },
  ],
  companies: [
    { ticker: 'lkoh', exposure: 'export', currencyShare: 0.45 },
    { ticker: 'SBER', exposure: 'domestic', currencyShare: 0 },
  ],
});

describe('профили секторов и компаний', () => {
  it('читает драйверы сектора по названию и по ключу', () => {
    expect(sectorProfileOf(FILE, 'нефть и газ')?.key).toBe('energy');
    expect(sectorProfileOf(FILE, 'SECTOR_ENERGY')?.drivers).toContain('цена нефти');
    expect(sectorProfileOf(FILE, 'финансы')?.rate).toBe('positive');
    expect(sectorProfileOf(FILE, 'неизвестный сектор')).toBeUndefined();
  });

  it('находит профиль компании без учёта регистра', () => {
    expect(companyProfileOf(FILE, 'lkoh')?.exposure).toBe('export');
    expect(companyProfileOf(FILE, 'SBER')?.currencyShare).toBe(0);
    expect(companyProfileOf(FILE, 'GAZP')).toBeUndefined();
  });

  it('берёт профиль бумаги из файла, иначе — по сектору', () => {
    expect(exposureOf(FILE, 'LKOH', 'нефть и газ')).toEqual({
      exposure: 'export',
      currencyShare: 0.45,
      source: 'company',
    });
    // Бумаги нет в файле: профиль определяет сектор.
    expect(exposureOf(FILE, 'XXXX', 'материалы')).toEqual({ exposure: 'export', source: 'sector' });
    expect(exposureOf(FILE, 'YYYY', 'финансы')?.exposure).toBe('domestic');
    expect(exposureOf(FILE, 'ZZZZ', 'сектор не определён')).toBeUndefined();
  });

  it('объясняет чувствительность к курсу и ставке', () => {
    expect(sensitivityWord('positive', 'курс')).toBe('курс растёт — в плюс');
    expect(sensitivityWord('negative', 'ставка')).toBe('ставка растёт — в минус');
    expect(sensitivityWord('neutral', 'курс')).toBe('курс — влияние слабое');
  });

  it('без файла профилей работает как раньше', () => {
    expect(EMPTY_PROFILES.sectors.size).toBe(0);
    expect(exposureOf(EMPTY_PROFILES, 'LKOH', 'нефть и газ')?.exposure).toBe('export');
    expect(parseCompanyProfiles({ broken: true }).companies.size).toBe(0);
  });

  it('реальный файл проекта знает ключевые бумаги и сектора', () => {
    const profiles = loadCompanyProfiles('data/company-profiles.yaml');

    expect(companyProfileOf(profiles, 'PLZL')?.exposure).toBe('export');
    expect(companyProfileOf(profiles, 'SBER')?.exposure).toBe('domestic');
    expect(sectorProfileOf(profiles, 'материалы')?.drivers.length).toBeGreaterThan(0);
    expect(Object.keys(EXPOSURE_LABELS)).toEqual(['export', 'domestic', 'import', 'mixed']);
    // Файл существует и читается: страховка от опечатки в пути.
    expect(readFileSync('data/company-profiles.yaml', 'utf8').length).toBeGreaterThan(500);
  });
});
