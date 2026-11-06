import type { KeyRatePoint, KeyRateSnapshot } from './key-rate.types.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

const toIsoDate = (value: string): string | undefined => {
  const normalized = value.trim().replace(',', '.');
  if (ISO_DATE.test(normalized)) {
    // Ставка действует с календарной даты по Москве: берём дату как есть.
    // Перевод в UTC сдвигал бы её на день назад (00:00+03:00 = 21:00 UTC).
    return Number.isNaN(Date.parse(normalized)) ? undefined : normalized.slice(0, 10);
  }
  const dotted = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(normalized);
  return dotted ? `${dotted[3]}-${dotted[2]}-${dotted[1]}` : undefined;
};

const toRate = (value: string): number | undefined => {
  const parsed = Number.parseFloat(value.trim().replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** Разбор ответа SOAP-метода `KeyRateXML`: сначала теги, затем атрибуты. */
export const parseKeyRateXml = (xml: string): KeyRatePoint[] => {
  const points: KeyRatePoint[] = [];
  const push = (date: string, rate: string): void => {
    const iso = toIsoDate(date);
    const value = toRate(rate);
    if (iso && value !== undefined) {
      points.push({ date: iso, rate: value });
    }
  };

  for (const match of xml.matchAll(/<DT>([^<]+)<\/DT>\s*<Rate>([^<]+)<\/Rate>/gi)) {
    push(match[1], match[2]);
  }
  if (points.length === 0) {
    for (const match of xml.matchAll(/<KR[^>]*\bDATE="([^"]+)"[^>]*\bRATE="([^"]+)"/gi)) {
      push(match[1], match[2]);
    }
  }
  return points;
};

/** Разбор HTML-таблицы `hd_base/KeyRate`: строки «дата — значение». */
export const parseKeyRateHtml = (html: string): KeyRatePoint[] => {
  const points: KeyRatePoint[] = [];
  for (const match of html.matchAll(
    /<td[^>]*>\s*(\d{2}\.\d{2}\.\d{4})\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>/gi,
  )) {
    const iso = toIsoDate(match[1]);
    const value = toRate(match[2]);
    if (iso && value !== undefined) {
      points.push({ date: iso, rate: value });
    }
  }
  return points;
};

/** Только моменты изменения ставки, новые сверху: так их показывает ЦБ. */
export const toHistory = (points: KeyRatePoint[]): KeyRatePoint[] => {
  const ascending = [...points].sort((left, right) => left.date.localeCompare(right.date));
  const changes: KeyRatePoint[] = [];
  for (const point of ascending) {
    const previous = changes.at(-1);
    if (!previous || previous.rate !== point.rate) {
      changes.push(point);
    }
  }
  return changes.reverse();
};

/** Снимок ставки из точек истории. */
export const buildSnapshot = (
  points: KeyRatePoint[],
  origin: KeyRateSnapshot['origin'],
  asOf: string,
): KeyRateSnapshot | undefined => {
  const history = toHistory(points);
  const current = history[0];
  return current ? { current, history, origin, asOf } : undefined;
};

/** Тело SOAP-запроса `KeyRateXML` за период. */
export const soapKeyRateEnvelope = (fromIso: string, toIso: string): string =>
  '<?xml version="1.0" encoding="utf-8"?>' +
  '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
  'xmlns:xsd="http://www.w3.org/2001/XMLSchema" ' +
  'xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>' +
  '<KeyRateXML xmlns="http://web.cbr.ru/">' +
  `<fromDate>${fromIso}</fromDate><ToDate>${toIso}</ToDate>` +
  '</KeyRateXML></soap:Body></soap:Envelope>';

/** Адрес HTML-таблицы за период: резервный путь, если SOAP недоступен. */
export const htmlKeyRateUrl = (baseUrl: string, fromIso: string, toIso: string): string => {
  const toDotted = (iso: string): string => iso.split('-').reverse().join('.');
  const url = new URL(baseUrl);
  url.searchParams.set('UniDbQuery.Posted', 'True');
  url.searchParams.set('UniDbQuery.From', toDotted(fromIso));
  url.searchParams.set('UniDbQuery.To', toDotted(toIso));
  return url.toString();
};

/** Точки из сид-файла: поддерживаем `{points:[…]}` и голый массив. */
export const parseSeed = (raw: unknown): { points: KeyRatePoint[]; updatedAt?: string } => {
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { points?: unknown[] } | undefined)?.points)
      ? ((raw as { points: unknown[] }).points)
      : [];
  const points: KeyRatePoint[] = [];
  for (const item of list) {
    const record = (item ?? {}) as { date?: unknown; rate?: unknown };
    const iso = typeof record.date === 'string' ? toIsoDate(record.date) : undefined;
    const rate = typeof record.rate === 'number' ? record.rate : Number.parseFloat(String(record.rate));
    if (iso && Number.isFinite(rate) && rate > 0) {
      points.push({ date: iso, rate });
    }
  }
  const updatedAt = (raw as { updatedAt?: unknown } | undefined)?.updatedAt;
  return { points, updatedAt: typeof updatedAt === 'string' ? updatedAt : undefined };
};

