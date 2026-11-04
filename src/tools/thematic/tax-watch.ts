import type { DynamicStructuredTool } from '@langchain/core/tools';
import { formatNumber } from '../../agent/report/portfolio-report.js';
import type { SourceCoverageEntry, SourceRegistry } from '../../sources/registry.js';
import type { SourceItem } from '../../sources/types.js';
import { asJson } from '../portfolio-snapshot.js';
import { withTimeout } from '../mcp-tool.adapter.js';

export const TAX_WATCH_TOOL = 'market__tax_watch';

/** Словарь по умолчанию: файл `TAX_KEYWORDS_FILE` дополняет и заменяет его. */
export const DEFAULT_TAX_KEYWORDS = [
  'ндфл',
  'налог',
  'налогооблож',
  'нк рф',
  'налоговый кодекс',
  'вычет',
  'лдв',
  'иис',
  'прогрессивн',
  'ставка налога',
  'дивиденд',
  'купон',
];

export interface TaxWithholding {
  currency: string;
  amount: number;
  operations: number;
  from: string;
  to: string;
}

export interface TaxFacts {
  /** Фактически удержанные налоги по счетам. */
  withheld: TaxWithholding[];
  /** Публикации об изменениях налогообложения. */
  changes: SourceItem[];
  coverage: SourceCoverageEntry[];
  asOf: string;
}

/** Совпадение заголовка или аннотации с любым термином словаря. */
export const matchesKeywords = (item: SourceItem, keywords: readonly string[]): boolean => {
  const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword.toLowerCase()));
};

interface RawOperation {
  type?: string;
  operationType?: string;
  payment?: { currency?: string; value?: string };
  date?: string;
  state?: string;
}

/** Удержанные налоги из истории операций: типы, содержащие TAX. */
export const sumTaxOperations = (
  raw: unknown,
  range: { from: string; to: string },
): TaxWithholding[] => {
  const root = asJson(raw) as { operations?: RawOperation[] } | undefined;
  const operations = Array.isArray(root?.operations) ? root.operations : [];
  const totals = new Map<string, TaxWithholding>();

  for (const operation of operations) {
    const type = `${operation.operationType ?? operation.type ?? ''}`.toUpperCase();
    if (!type.includes('TAX')) {
      continue;
    }
    const amount = Math.abs(Number.parseFloat(operation.payment?.value ?? '0'));
    const currency = (operation.payment?.currency ?? 'rub').toUpperCase();
    if (!Number.isFinite(amount) || amount === 0) {
      continue;
    }
    const current = totals.get(currency) ?? {
      currency,
      amount: 0,
      operations: 0,
      from: range.from,
      to: range.to,
    };
    current.amount = Math.round((current.amount + amount) * 100) / 100;
    current.operations += 1;
    totals.set(currency, current);
  }

  return [...totals.values()];
};

export interface TaxWatchDeps {
  registry: SourceRegistry;
  tool: (name: string) => DynamicStructuredTool | undefined;
  timeoutMs: number;
  accounts: readonly string[];
  keywords: readonly string[];
  pages: number;
  maxItems: number;
  days?: number;
  now?: Date;
}

/**
 * Налоговое наблюдение: факты удержаний из операций брокера + публикации об
 * изменениях законодательства по словарю.
 */
export const collectTaxFacts = async (deps: TaxWatchDeps): Promise<TaxFacts> => {
  const now = deps.now ?? new Date();
  const days = deps.days ?? 365;
  const from = new Date(now.getTime() - days * 24 * 3_600_000).toISOString();
  const to = now.toISOString();
  const coverage: SourceCoverageEntry[] = [];
  const withheld: TaxWithholding[] = [];

  const operationsTool = deps.tool('invest_get_operations');
  if (!operationsTool) {
    coverage.push({ source: 'tinkoff.operations', status: 'missing', reason: 'инструмент недоступен' });
  } else {
    for (const accountId of deps.accounts) {
      try {
        const raw = await withTimeout(
          operationsTool.invoke({ accountId, from, to } as never),
          deps.timeoutMs,
          () => new Error('таймаут операций'),
        );
        withheld.push(...sumTaxOperations(raw, { from, to }));
      } catch (error) {
        coverage.push({
          source: 'tinkoff.operations',
          status: 'missing',
          reason: (error as Error)?.message ?? 'ошибка',
        });
      }
    }
    if (coverage.length === 0) {
      coverage.push({ source: 'tinkoff.operations', status: 'ok', items: withheld.length });
    }
  }

  let changes: SourceItem[] = [];
  try {
    const digest = await deps.registry.newsDigest(
      { pages: deps.pages, maxItems: Math.max(deps.maxItems, 20), sinceDays: 365 },
      'tax',
    );
    changes = digest.items.filter((item) => matchesKeywords(item, deps.keywords)).slice(0, deps.maxItems);
    coverage.push(...digest.coverage.map((entry) => ({ ...entry, source: `news:${entry.source}` })));
  } catch (error) {
    coverage.push({
      source: 'news',
      status: 'missing',
      reason: (error as Error)?.message ?? 'ошибка',
    });
  }

  return { withheld, changes, coverage, asOf: now.toISOString() };
};

/** Текст налогового раздела: сначала факты, затем найденные изменения. */
export const formatTaxFacts = (facts: TaxFacts): string => {
  const lines: string[] = [];

  if (facts.withheld.length === 0) {
    lines.push('Удержанных налогов в истории операций не найдено.');
  } else {
    lines.push('Удержанные налоги:');
    for (const item of facts.withheld) {
      lines.push(
        `• ${formatNumber(item.amount)} ${item.currency} за ${item.operations} операционных начислений (${item.from.slice(0, 10)} — ${item.to.slice(0, 10)})`,
      );
    }
  }

  if (facts.changes.length === 0) {
    lines.push('Публикаций об изменениях налогообложения в источниках нет.');
  } else {
    lines.push('Изменения налогообложения:');
    for (const item of facts.changes) {
      lines.push(`• ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`);
    }
  }

  return lines.join('\n');
};
