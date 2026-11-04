/**
 * Сектор бумаги: T-Invest отдаёт его в справочнике актива (`brand.sector`).
 * Здесь — разбор ответа, русские названия и честный фолбэк «не определён».
 */

/** Человекочитаемые названия секторов T-Invest API. */
export const SECTOR_LABELS: Record<string, string> = {
  SECTOR_FINANCIAL: 'финансы',
  SECTOR_CONSUMER_GOODS: 'потребительские товары',
  SECTOR_HEALTH_CARE: 'здравоохранение',
  SECTOR_MATERIALS: 'материалы',
  SECTOR_INDUSTRIALS: 'промышленность',
  SECTOR_ENERGY: 'энергетика',
  SECTOR_ELECTRONICS: 'электроника',
  SECTOR_CONSUMER_SERVICES: 'потребительские услуги',
  SECTOR_TELECOM: 'телеком',
  SECTOR_UTILITIES: 'коммунальные услуги',
  SECTOR_REAL_ESTATE: 'недвижимость',
  SECTOR_IT: 'информационные технологии',
  SECTOR_TRANSPORT: 'транспорт',
  SECTOR_OTHER: 'прочее',
};

/** Значение, когда брокер не сообщил сектор. */
export const UNKNOWN_SECTOR = 'сектор не определён';

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};

const asText = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

/** Название сектора: enum → русское название, иначе как пришло. */
export const sectorLabel = (raw: string | undefined): string => {
  if (!raw || raw === 'SECTOR_UNSPECIFIED') {
    return UNKNOWN_SECTOR;
  }
  return SECTOR_LABELS[raw] ?? raw;
};

/**
 * Сектор из ответа справочника актива: ищем `brand.sector`, `asset.brand.sector`
 * или `sector` в корне — форма ответа у брокера менялась, разбор терпимый.
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

  return candidates.find((value) => value !== undefined && value !== 'SECTOR_UNSPECIFIED');
};

/** Идентификатор актива из ответа `invest_get_asset` или позиции. */
export const assetUidOf = (payload: unknown): string | undefined => {
  const root = asRecord(payload);
  const asset = asRecord(root.asset ?? root);
  return asText(asset.uid) ?? asText(root.uid) ?? asText(asset.instrumentUid);
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
