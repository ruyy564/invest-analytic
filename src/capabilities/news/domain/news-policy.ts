import { readFileSync } from 'node:fs';
import { parseYaml } from '../../../parsing/yaml.js';
import type { CanonicalItem } from './canonical-item.js';

/** Сырой вид политики из YAML: строки — это регулярки. */
export interface NewsPolicyRaw {
  version: number;
  digest: string[];
  off_topic: string[];
  investment_markers: string[];
  relevance: { by_ticker: 'title_only' | 'title_or_summary'; allow_tag_binding: boolean };
}

/** Скомпилированная политика: регулярки готовы к проверке. */
export interface NewsPolicy {
  version: number;
  digest: RegExp[];
  offTopic: RegExp[];
  markers: RegExp[];
  relevance: NewsPolicyRaw['relevance'];
}

const compile = (patterns: string[]): RegExp[] =>
  patterns.map((pattern) => {
    try {
      return new RegExp(pattern, 'i');
    } catch {
      // Битое правило не должно ломать всю политику: пропускаем его.
      return /(?!)/;
    }
  });

export const compileNewsPolicy = (raw: NewsPolicyRaw): NewsPolicy => ({
  version: raw.version,
  digest: compile(raw.digest),
  offTopic: compile(raw.off_topic),
  markers: compile(raw.investment_markers),
  relevance: raw.relevance,
});

const cache = new Map<string, NewsPolicy>();

/** Политика из файла: читается один раз на путь. */
export const loadNewsPolicy = (path = 'data/policy/news.yaml'): NewsPolicy => {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  const raw = parseYaml(readFileSync(path, 'utf8')) as unknown as NewsPolicyRaw;
  const policy = compileNewsPolicy(raw);
  cache.set(path, policy);
  return policy;
};

/** Сброс кэша: нужен тестам и правке политики без перезапуска. */
export const resetNewsPolicyCache = (): void => cache.clear();

export type PolicyMode = 'general' | 'ticker';

export interface PolicyContext {
  mode: PolicyMode;
  /** Подстроки для привязки к бумаге: тикер, название, алиасы. */
  matchers?: readonly string[];
  /** Тикеры для привязки по тегам инструментов. */
  tickers?: readonly string[];
}

export interface PolicyDecision {
  keep: boolean;
  reason: string;
}

const matches = (patterns: readonly RegExp[], text: string): boolean =>
  patterns.some((pattern) => pattern.test(text));

/** Правило «это новость по бумаге»: заголовок или тег инструмента. */
const tickerDecision = (
  item: CanonicalItem,
  ctx: PolicyContext,
  policy: NewsPolicy,
): PolicyDecision | undefined => {
  const matchers = (ctx.matchers ?? []).map((value) => value.trim().toLowerCase()).filter((value) => value.length > 1);
  const tickers = (ctx.tickers ?? []).map((value) => value.trim().toUpperCase()).filter(Boolean);
  if (matchers.length === 0 && tickers.length === 0) {
    return undefined;
  }

  const haystack =
    policy.relevance.by_ticker === 'title_only'
      ? item.title.toLowerCase()
      : `${item.title} ${item.summary ?? ''}`.toLowerCase();
  if (matchers.some((matcher) => haystack.includes(matcher))) {
    return { keep: true, reason: 'ticker_match' };
  }

  const bound =
    policy.relevance.allow_tag_binding &&
    item.instrumentTags.some((tag) => tickers.includes(tag.toUpperCase()));
  return bound ? { keep: true, reason: 'tag_binding' } : { keep: false, reason: 'no_matcher' };
};

/**
 * Единое решение по элементу: общие сводки и темы вне повестки отбрасываются
 * всегда, дальше — правило режима (общая лента или новости по бумаге).
 */
export const evaluateItem = (
  item: CanonicalItem,
  ctx: PolicyContext,
  policy: NewsPolicy,
): PolicyDecision => {
  if (matches(policy.digest, item.title)) {
    return { keep: false, reason: 'digest' };
  }

  const byTicker = ctx.mode === 'ticker' ? tickerDecision(item, ctx, policy) : undefined;
  if (byTicker) {
    return byTicker;
  }

  if (matches(policy.offTopic, item.title)) {
    return { keep: false, reason: 'off_topic' };
  }
  const text = `${item.title} ${item.summary ?? ''}`;
  return matches(policy.markers, text)
    ? { keep: true, reason: 'marker' }
    : { keep: false, reason: 'no_marker' };
};
