import type {
  CommoditySnapshot,
  CommoditySource,
  MetalCode,
  MetalQuote,
} from './commodity.types.js';

/** XML учётных цен драгметаллов ЦБ: параметры — даты `ДД/ММ/ГГГГ`. */
export const CBR_METALS_URL = 'https://www.cbr.ru/scripts/XML_metall.asp';

/** URL котировок за период: ЦБ отдаёт XML в windows-1251. */
export const cbrMetalsUrl = (from: Date, to: Date): string => {
  const format = (date: Date): string =>
    `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
  return `${CBR_METALS_URL}?date_req1=${format(from)}&date_req2=${format(to)}`;
};

/** Коды металлов в XML ЦБ. */
const METAL_CODES: Record<string, MetalCode> = {
  '1': 'gold',
  '2': 'silver',
  '3': 'platinum',
  '4': 'palladium',
};

const asNumber = (raw: string): number | undefined => {
  const value = Number(raw.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : undefined;
};

/**
 * XML ЦБ → котировки последней доступной даты. Формат записи:
 * `<Record Date="03.11.2026" Code="1"><Buy>10187,57</Buy></Record>`.
 */
export const parseMetalsXml = (xml: string): MetalQuote[] => {
  const quoted = new Map<MetalCode, MetalQuote>();
  const records = /<Record Date="([^"]+)" Code="(\d)">\s*<Buy>([^<]+)<\/Buy>/g;
  for (const match of xml.matchAll(records)) {
    const metal = METAL_CODES[match[2]];
    const price = asNumber(match[3]);
    if (!metal || price === undefined) {
      continue;
    }
    quoted.set(metal, { metal, price, date: match[1] });
  }
  if (quoted.size === 0) {
    return [];
  }
  // ЦБ может вернуть несколько дат: оставляем самую свежую.
  const latest = [...quoted.values()].reduce((best, quote) =>
    quote.date > best.date ? quote : best,
  ).date;
  return [...quoted.values()].filter((quote) => quote.date === latest);
};

export interface CbrCommodityOptions {
  requestTimeoutMs?: number;
  /** Сколько живёт снимок в памяти процесса. */
  cacheTtlMs?: number;
  now?: () => Date;
  /** Подмена загрузчика в тестах: возвращает уже раскодированный XML. */
  fetchXml?: (url: string) => Promise<string>;
}

const defaultFetchXml = (timeoutMs: number) => async (url: string): Promise<string> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  // Учётные цены приходят в windows-1251: `response.text()` дал бы кракозябры.
  const bytes = await response.arrayBuffer();
  return new TextDecoder('windows-1251').decode(bytes);
};

/** Учётные цены драгметаллов ЦБ: XML ЦБ с кэшем в памяти процесса. */
export const createCbrCommoditySource = (options: CbrCommodityOptions = {}): CommoditySource => {
  const now = options.now ?? (() => new Date());
  const fetchXml = options.fetchXml ?? defaultFetchXml(options.requestTimeoutMs ?? 10_000);
  const ttlMs = options.cacheTtlMs ?? 6 * 3_600_000;
  let cached: { snapshot: CommoditySnapshot; at: number } | undefined;

  return {
    id: 'cbr',
    async read(): Promise<CommoditySnapshot | undefined> {
      const at = now();
      if (cached && at.getTime() - cached.at < ttlMs) {
        return { ...cached.snapshot, origin: 'cache' };
      }
      const from = new Date(at.getTime() - 7 * 24 * 3_600_000);
      const quotes = parseMetalsXml(await fetchXml(cbrMetalsUrl(from, at)));
      if (quotes.length === 0) {
        return undefined;
      }
      const snapshot: CommoditySnapshot = { quotes, origin: 'live', asOf: at.toISOString() };
      cached = { snapshot, at: at.getTime() };
      return snapshot;
    },
  };
};
