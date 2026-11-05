/**
 * Секторы отдаёт бренд актива, поэтому путь до них — три запроса
 * (`share → asset → brand`); он собран в `reference.ts`.
 * Здесь остаётся разбор ответов и честный фолбэк «не определён».
 *
 * Ключи секторов — как в T-Invest API (`financial`, `energy`, …): по ним же
 * подбираются драйверы сектора и профиль «экспортёр / внутренний рынок».
 */

/** Человекочитаемые названия секторов T-Invest API. */
export const SECTOR_LABELS: Record<string, string> = {
  financial: 'финансы',
  consumer: 'потребительский сектор',
  consumer_goods: 'потребительские товары',
  consumer_services: 'потребительские услуги',
  healthcare: 'здравоохранение',
  materials: 'материалы',
  industrials: 'промышленность',
  energy: 'нефть и газ',
  electronics: 'электроника',
  telecom: 'телеком',
  utilities: 'электроэнергетика',
  green_energy: 'зелёная энергетика',
  real_estate: 'недвижимость',
  it: 'технологии',
  transport: 'транспорт',
  other: 'прочее',
};

/** Значение, когда брокер не сообщил сектор. */
export const UNKNOWN_SECTOR = 'сектор не определён';

/**
 * Алиасы: бренд отдаёт сектор строкой (`energy`), справочник актива — enum-ом
 * (`SECTOR_ENERGY`). Оба вида приводим к ключу сектора.
 */
export const SECTOR_ALIASES: Record<string, string> = {
  financial: 'financial',
  financials: 'financial',
  banks: 'financial',
  energy: 'energy',
  oil_and_gas: 'energy',
  oil_gas: 'energy',
  oil: 'energy',
  gas: 'energy',
  materials: 'materials',
  basic_materials: 'materials',
  metals: 'materials',
  mining: 'materials',
  industrials: 'industrials',
  industry: 'industrials',
  healthcare: 'healthcare',
  health_care: 'healthcare',
  consumer: 'consumer',
  consumer_goods: 'consumer_goods',
  consumer_cyclical: 'consumer_goods',
  retail: 'consumer_goods',
  consumer_services: 'consumer_services',
  telecom: 'telecom',
  telecommunications: 'telecom',
  utilities: 'utilities',
  power: 'utilities',
  electricity: 'utilities',
  green_energy: 'green_energy',
  alternative_energy: 'green_energy',
  real_estate: 'real_estate',
  it: 'it',
  technology: 'it',
  information_technology: 'it',
  electronics: 'electronics',
  transport: 'transport',
  transportation: 'transport',
  other: 'other',
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const normalizeSector = (raw: string): string =>
  raw
    .toLowerCase()
    .trim()
    .replace(/^sector_/, '')
    .replace(/[\s-]+/g, '_');

/** Русские названия → ключи: сектор приходит и строкой бренда, и названием. */
const LABEL_TO_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(SECTOR_LABELS).map(([key, label]) => [normalizeSector(label), key]),
);

/** Ключ сектора: `SECTOR_ENERGY`, `energy`, `oil_and_gas`, «нефть и газ» → `energy`. */
export const sectorKey = (raw: string | undefined): string | undefined => {
  if (!raw || raw === 'SECTOR_UNSPECIFIED' || raw === 'unspecified') {
    return undefined;
  }
  const normalized = normalizeSector(raw);
  return (
    SECTOR_ALIASES[normalized] ??
    LABEL_TO_KEY[normalized] ??
    (SECTOR_LABELS[normalized] ? normalized : undefined)
  );
};

/** Название сектора: enum или строка бренда → русское название. */
export const sectorLabel = (raw: string | undefined): string => {
  if (!raw || raw === 'SECTOR_UNSPECIFIED' || raw === 'unspecified') {
    return UNKNOWN_SECTOR;
  }
  const key = sectorKey(raw);
  return key ? SECTOR_LABELS[key] : raw;
};

/**
 * Сектор из ответа справочника. Форма ответа у брокера менялась, поэтому
 * порядок такой: известные пути → любой `"sector"` в ответе → ничего.
 */
export const sectorOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const brand = asRecord(asset.brand ?? root.brand);

  const candidates = [
    asText(brand.sector),
    asText(asset.sector),
    asText(root.sector),
    asText(asRecord(brand.sector).name),
  ];

  const direct = candidates.find(
    (value) => value !== undefined && value !== 'SECTOR_UNSPECIFIED',
  );
  if (direct) {
    return direct;
  }

  // Последний шанс: сектор лежит глубже, чем мы предполагали.
  try {
    const match = /"sector"\s*:\s*"(SECTOR_[A-Z_]+)"/.exec(JSON.stringify(payload));
    const value = match?.[1];
    return value && value !== 'SECTOR_UNSPECIFIED' ? value : undefined;
  } catch {
    return undefined;
  }
};

/** Идентификатор бренда: сектор можно добрать через `invest_get_brand`. */
export const brandUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const brand = asRecord(asset.brand ?? root.brand);
  return asText(brand.uid) ?? asText(asset.brandUid) ?? asText(root.brandUid);
};

/** Идентификатор актива из ответа справочника или позиции. */
export const assetUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  const instrument = asRecord(asset.instrument ?? root.instrument);
  return (
    asText(asset.uid) ??
    asText(root.uid) ??
    // `invest_get_share` с `responseView: FULL` отдаёт uid актива здесь.
    asText(instrument.assetUid) ??
    asText(root.assetUid) ??
    asText(asset.instrumentUid)
  );
};

/** Разбор собранных ответов справочника: сектор и бренд по тикерам. */
export const sectorLookup = (
  entries: { target?: string; text: string }[],
): { byTicker: Map<string, string>; brandByTicker: Map<string, string> } => {
  const byTicker = new Map<string, string>();
  const brandByTicker = new Map<string, string>();

  for (const { target, text } of entries) {
    if (!target) {
      continue;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const sector = sectorOf(payload);
    if (sector) {
      byTicker.set(target, sectorLabel(sector));
      continue;
    }
    const brandUid = brandUidOf(payload);
    if (brandUid) {
      brandByTicker.set(target, brandUid);
    }
  }

  return { byTicker, brandByTicker };
};

/** Карта «тикер → сектор» из собранных ответов справочника. */
export const sectorByTicker = (
  entries: { target?: string; text: string }[],
): Map<string, string> => {
  const map = new Map<string, string>();
  for (const { target, text } of entries) {
    let payload: unknown;
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      continue;
    }
    const sector = sectorOf(payload);
    if (target && sector) {
      map.set(target, sectorLabel(sector));
    }
  }
  return map;
};
