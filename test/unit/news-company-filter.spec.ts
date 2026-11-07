import { NewsRegistry } from '../../src/capabilities/news/news.registry.js';
import type { NewsSourceAdapter, SourceItem } from '../../src/capabilities/news/news.types.js';
import { createNewsSearchTool } from '../../src/capabilities/news/tools/news-search.tool.js';

const NOW = Date.now();

const item = (title: string, summary = ''): SourceItem => ({
  id: title,
  title,
  summary,
  publishedAt: new Date(NOW - 24 * 60 * 60 * 1000).toISOString(),
  tags: [],
  source: 'kommersant',
});

const registryOf = (items: SourceItem[]): NewsRegistry => {
  const adapter: NewsSourceAdapter = {
    id: 'kommersant',
    topics: ['news'],
    supportsMatcherQuery: true,
    fetchNews: async () => items,
  };
  return new NewsRegistry([adapter]);
};

const search = async (ticker: string, items: SourceItem[]): Promise<string> => {
  const tool = createNewsSearchTool({ registry: registryOf(items), scanPages: 1, maxItems: 20 });
  return String(await tool.invoke({ ticker, days: 7 }));
};

describe('новости бумаги с омонимом в названии', () => {
  it('авиационные публикации к застройщику «Самолет» не относятся', async () => {
    // «Самолёт» — и застройщик (SMLT), и авиация: без фильтра динамику бумаги
    // объясняют новостью про севший в Бордо борт.
    const text = await search('SMLT', [
      item(
        'Акции «Самолета» выросли на 8,6% после заявления о договоренности кредиторов',
        'Акции застройщика прибавляли 8,64% к закрытию предыдущей сессии',
      ),
      item('Летевший из Мадрида в Париж самолет подал аварийный сигнал и сел в Бордо'),
      item('Минтранс продлит особый режим эксплуатации иностранных самолетов'),
    ]);

    expect(text).toContain('Акции «Самолета» выросли');
    expect(text).not.toContain('Бордо');
    expect(text).not.toContain('Минтранс');
  });

  it('без контекста компании публикация не считается новостью бумаги', async () => {
    // Омоним в заголовке есть, а к застройщику публикация не относится.
    const text = await search('SMLT', [item('Над Черным морем заметили самолет разведчик')]);

    expect(text).not.toContain('разведчик');
  });

  it('бумаги без омонимов фильтруются только по тикеру и названию', async () => {
    // У «Лукойла» омонимов нет: контекст не требуется, иначе теряются новости.
    const text = await search('LKOH', [item('Лукойл снизил добычу нефти на 3%')]);

    expect(text).toContain('Лукойл снизил добычу');
  });
});
