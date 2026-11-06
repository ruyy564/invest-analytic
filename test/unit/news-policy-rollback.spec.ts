import { readFileSync } from 'node:fs';
import { buildNewsRegistry } from '../../src/capabilities/news/news.factory.js';
import { resetNewsPolicyCache } from '../../src/capabilities/news/index.js';

const RSS = readFileSync('test/fixtures/golden/interfax.rss', 'utf8');

const configOf = (policyV2: boolean): never =>
  ({
    sources: {
      enabled: ['interfax'],
      news: {
        ids: ['interfax'],
        scanPages: 1,
        maxItems: 5,
        policyV2,
        policyFile: 'data/policy/news.yaml',
      },
      newsFeed: { enabled: true, periodDays: [1, 7], maxPerPeriod: 8 },
      taxKeywordsFile: 'data/tax-keywords.yaml',
    },
    run: { mcpToolTimeoutMs: 100 },
  }) as never;

const sourceOf = (policyV2: boolean) => {
  const registry = buildNewsRegistry({
    config: configOf(policyV2),
    tool: () => undefined,
    env: {} as NodeJS.ProcessEnv,
    fetchText: async () => RSS,
  });
  const source = registry.newsSources.find((item) => item.id === 'interfax');
  if (!source?.fetchNewsWithReport) {
    throw new Error('источник interfax не собран');
  }
  return source;
};

beforeAll(() => {
  resetNewsPolicyCache();
});

describe('откат политики новостей', () => {
  it('с включённой политикой отбраковка видна в отчёте стадий', async () => {
    const result = await sourceOf(true).fetchNewsWithReport?.({ pages: 1, maxItems: 10 });

    expect(result?.items).toHaveLength(1);
    expect(result?.dropped?.map((entry) => entry.reason)).toEqual(
      expect.arrayContaining(['digest', 'no_marker']),
    );
  });

  it('с выключенным флагом работает прежнее поведение', async () => {
    const result = await sourceOf(false).fetchNewsWithReport?.({ pages: 1, maxItems: 10 });

    // Старые фильтры: дайджест отсекается, «АдГ» проходит.
    expect(result?.items).toHaveLength(2);
    expect(result?.dropped).toBeUndefined();
  });
});
