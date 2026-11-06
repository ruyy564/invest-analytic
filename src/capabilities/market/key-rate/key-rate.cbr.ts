import type { KeyRatePoint, KeyRateSnapshot, KeyRateSource } from './key-rate.types.js';
import { KeyRateCache, readSeedFile } from './key-rate.cache.js';

import {
  buildSnapshot,
  htmlKeyRateUrl,
  parseKeyRateHtml,
  parseKeyRateXml,
  parseSeed,
  soapKeyRateEnvelope,
} from './key-rate.parsers.js';

export {
  buildSnapshot,
  htmlKeyRateUrl,
  parseKeyRateHtml,
  parseKeyRateXml,
  parseSeed,
  soapKeyRateEnvelope,
  toHistory,
} from './key-rate.parsers.js';

export interface CbrSourceOptions {
  mode: 'live' | 'seed' | 'off';
  soapUrl: string;
  htmlUrl: string;
  seedFile: string;
  cache: KeyRateCache;
  requestTimeoutMs?: number;
  /** Глубина истории при live-запросе, лет. */
  yearsBack?: number;
  now?: () => Date;
  fetchText?: (url: string, init?: RequestInit) => Promise<string>;
}

const CACHE_KEY = 'cbr.key_rate';

const defaultFetch = (timeoutMs: number) => async (url: string, init?: RequestInit): Promise<string> => {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.text();
};

/**
 * Ставка ЦБ: цепочка «кэш → SOAP ЦБ → сид-файл → HTML-таблица».
 * Любой шаг может быть недоступен — тогда используется следующий.
 */
export const createCbrSource = (options: CbrSourceOptions): KeyRateSource => {
  const now = options.now ?? (() => new Date());
  const fetchText = options.fetchText ?? defaultFetch(options.requestTimeoutMs ?? 10_000);
  const yearsBack = options.yearsBack ?? 3;

  const period = (at: Date): { from: string; to: string } => {
    const to = at.toISOString().slice(0, 10);
    const from = new Date(at.getTime() - yearsBack * 365 * 24 * 3_600_000).toISOString().slice(0, 10);
    return { from, to };
  };

  const fromSeed = (): KeyRateSnapshot | undefined => {
    const seed = parseSeed(readSeedFile(options.seedFile));
    const snapshot = buildSnapshot(seed.points, 'seed', seed.updatedAt ?? now().toISOString());
    return snapshot;
  };

  const fromCache = (): KeyRateSnapshot | undefined => {
    const cached = options.cache.get(CACHE_KEY, now());
    if (!cached) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(cached) as { points?: KeyRatePoint[]; asOf?: string };
      return buildSnapshot(parsed.points ?? [], 'cache', parsed.asOf ?? now().toISOString());
    } catch {
      return undefined;
    }
  };

  return {
    id: 'cbr',
    async read(): Promise<KeyRateSnapshot | undefined> {
      if (options.mode === 'off') {
        return undefined;
      }
      if (options.mode === 'seed') {
        return fromSeed();
      }

      const cached = fromCache();
      if (cached) {
        return cached;
      }

      const { from, to } = period(now());
      try {
        const xml = await fetchText(options.soapUrl, {
          method: 'POST',
          headers: {
            'content-type': 'text/xml; charset=utf-8',
            soapaction: '"http://web.cbr.ru/KeyRateXML"',
          },
          body: soapKeyRateEnvelope(from, to),
        });
        const points = parseKeyRateXml(xml);
        const snapshot = buildSnapshot(points, 'live', now().toISOString());
        if (snapshot) {
          options.cache.put(CACHE_KEY, JSON.stringify({ points, asOf: snapshot.asOf }), now());
          return snapshot;
        }
      } catch {
        // SOAP недоступен — идём по цепочке дальше.
      }

      const seed = fromSeed();
      if (seed) {
        return seed;
      }

      try {
        const html = await fetchText(htmlKeyRateUrl(options.htmlUrl, from, to));
        const snapshot = buildSnapshot(parseKeyRateHtml(html), 'html', now().toISOString());
        if (snapshot) {
          options.cache.put(CACHE_KEY, JSON.stringify({ points: snapshot.history, asOf: snapshot.asOf }), now());
          return snapshot;
        }
      } catch {
        // Ничего не осталось: отчёт честно скажет об отсутствии данных.
      }

      return undefined;
    },
  };
};
