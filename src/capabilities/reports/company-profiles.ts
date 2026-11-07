import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { parseYaml } from '../../shared/parsing/yaml.js';
import { sectorKey, UNKNOWN_SECTOR } from './sector.js';

/**
 * Профили секторов и компаний: драйверы сектора и внешнеэкономический профиль
 * бумаги. Файл необязателен: без него отчёт работает без этих строк.
 */

/** Чувствительность выручки к фактору. */
export const SENSITIVITIES = ['positive', 'negative', 'neutral'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];

/** Внешнеэкономический профиль: экспортёр, внутренний рынок, импортёр, смешанный. */
export const EXPOSURES = ['export', 'domestic', 'import', 'mixed'] as const;
export type Exposure = (typeof EXPOSURES)[number];

const SectorSchema = z.object({
  key: z.string().trim().min(1),
  drivers: z.array(z.string()).default([]),
  /** Ключи для поиска публикаций по драйверам: «нефть», «Brent», «санкц». */
  factors: z.array(z.string()).default([]),
  currency: z.enum(SENSITIVITIES).default('neutral'),
  rate: z.enum(SENSITIVITIES).default('neutral'),
});

const CompanySchema = z.object({
  ticker: z.string().trim().min(1),
  /** Сектор бумаги: по нему подбираются факторы поиска новостей. */
  sector: z.string().trim().optional(),
  exposure: z.enum(EXPOSURES),
  currencyShare: z.number().min(0).max(1).optional(),
  note: z.string().trim().optional(),
  /**
   * Слова-омонимы компании: по ним публикации к бумаге не относятся.
   * «Самолёт» — это и застройщик (SMLT), и авиация: без фильтра динамика
   * объясняется новостями про аэропорты и рейсы.
   */
  exclude: z.array(z.string()).default([]),
  /**
   * Обязательный контекст для бумаг с омонимом: без него публикация к компании
   * не относится («самолёт сел в Бордо» — это авиация, а не застройщик).
   */
  context: z.array(z.string()).default([]),
});

const MarketFactorSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  keywords: z.array(z.string()).default([]),
});

const ProfilesSchema = z.object({
  version: z.number().int().positive().default(1),
  sectors: z.array(SectorSchema).default([]),
  marketFactors: z.array(MarketFactorSchema).default([]),
  companies: z.array(CompanySchema).default([]),
});

export interface SectorProfile {
  key: string;
  drivers: string[];
  factors: string[];
  currency: Sensitivity;
  rate: Sensitivity;
}

export interface CompanyProfile {
  ticker: string;
  sector?: string;
  exposure: Exposure;
  /** Доля валютной выручки, 0..1. */
  currencyShare?: number;
  note?: string;
  /** Слова-омонимы: публикации с ними к бумаге не относятся. */
  exclude: string[];
  /** Обязательный контекст: без этих слов публикация к бумаге не относится. */
  context: string[];
}

/** Рыночный фактор: ищется по всем бумагам («курс рубля», «санкции»). */
export interface MarketFactor {
  id: string;
  title: string;
  keywords: string[];
}

export interface CompanyProfiles {
  sectors: Map<string, SectorProfile>;
  marketFactors: MarketFactor[];
  companies: Map<string, CompanyProfile>;
}

export const EMPTY_PROFILES: CompanyProfiles = {
  sectors: new Map(),
  marketFactors: [],
  companies: new Map(),
};

/** Эвристика по сектору: если бумаги нет в файле, профиль берём у сектора. */
const EXPOSURE_BY_SECTOR: Record<string, Exposure> = {
  energy: 'export',
  materials: 'export',
  it: 'mixed',
  consumer_goods: 'import',
  consumer_services: 'domestic',
  consumer: 'domestic',
  financial: 'domestic',
  telecom: 'domestic',
  utilities: 'domestic',
  green_energy: 'domestic',
  real_estate: 'domestic',
  transport: 'domestic',
  healthcare: 'domestic',
  industrials: 'domestic',
  electronics: 'import',
  other: 'mixed',
};

/** Названия профилей для отчёта. */
export const EXPOSURE_LABELS: Record<Exposure, string> = {
  export: 'экспортёр',
  domestic: 'внутренний рынок',
  import: 'импортёр',
  mixed: 'смешанный',
};

/** Что значит рост фактора для выручки: плюс, минус или нейтрально. */
export const sensitivityWord = (sensitivity: Sensitivity, factor: 'курс' | 'ставка'): string => {
  if (sensitivity === 'positive') {
    return `${factor} растёт — в плюс`;
  }
  if (sensitivity === 'negative') {
    return `${factor} растёт — в минус`;
  }
  return `${factor} — влияние слабое`;
};

/** Разбор файла профилей: неизвестные поля игнорируются, битые записи пропускаются. */
export const parseCompanyProfiles = (raw: unknown): CompanyProfiles => {
  const parsed = ProfilesSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    return EMPTY_PROFILES;
  }
  const sectors = new Map<string, SectorProfile>();
  for (const sector of parsed.data.sectors) {
    const key = sectorKey(sector.key) ?? sector.key.toLowerCase();
    sectors.set(key, { ...sector, key });
  }
  const companies = new Map<string, CompanyProfile>();
  for (const company of parsed.data.companies) {
    companies.set(company.ticker.toUpperCase(), {
      ...company,
      ticker: company.ticker.toUpperCase(),
    });
  }
  return { sectors, marketFactors: parsed.data.marketFactors, companies };
};

const cache = new Map<string, CompanyProfiles>();

/** Профили из YAML-файла; отсутствие файла — пустые профили, а не ошибка. */
export const loadCompanyProfiles = (path: string): CompanyProfiles => {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  let profiles = EMPTY_PROFILES;
  try {
    profiles = parseCompanyProfiles(parseYaml(readFileSync(path, 'utf8')) ?? {});
  } catch {
    profiles = EMPTY_PROFILES;
  }
  cache.set(path, profiles);
  return profiles;
};

/** Профиль сектора по названию или ключу (`нефть и газ`, `energy`, `SECTOR_ENERGY`). */
export const sectorProfileOf = (
  profiles: CompanyProfiles,
  sector: string | undefined,
): SectorProfile | undefined => {
  if (!sector || sector === UNKNOWN_SECTOR) {
    return undefined;
  }
  const key = sectorKey(sector);
  return key ? profiles.sectors.get(key) : undefined;
};

/** Профиль компании по тикеру. */
export const companyProfileOf = (
  profiles: CompanyProfiles,
  ticker: string | undefined,
): CompanyProfile | undefined =>
  ticker ? profiles.companies.get(ticker.toUpperCase()) : undefined;

/** Профиль бумаги: из файла, иначе по сектору; `undefined` — данных нет. */
export const exposureOf = (
  profiles: CompanyProfiles,
  ticker: string | undefined,
  sector: string | undefined,
): { exposure: Exposure; currencyShare?: number; source: 'company' | 'sector' } | undefined => {
  const company = companyProfileOf(profiles, ticker);
  if (company) {
    return { exposure: company.exposure, currencyShare: company.currencyShare, source: 'company' };
  }
  const key = sectorKey(sector);
  const exposure = key ? EXPOSURE_BY_SECTOR[key] : undefined;
  return exposure ? { exposure, source: 'sector' } : undefined;
};
