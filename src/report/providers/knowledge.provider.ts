import type { FactContext, FactProvider, SectionFacts } from '../engine.js';
import { formatKnowledgeBlock, type KnowledgeProvider, type KnowledgeTopic } from '../../knowledge/index.js';
import { UNKNOWN_SECTOR } from '../sector.js';
import { sectorMapOf, valuedHoldings } from './portfolio/index.js';

/**
 * Справочный блок отчёта: темы базы знаний под секторы портфеля или под бумагу.
 * Это принципы трактовки, а не данные рынка — блок помечен явно.
 */
export const createKnowledgeSectionProvider = (
  knowledge?: KnowledgeProvider,
): FactProvider => ({
  id: 'knowledge.context',
  section(ctx: FactContext): SectionFacts | undefined {
    if (!knowledge || knowledge.isEmpty || !knowledge.select) {
      return undefined;
    }

    const sectors = sectorMapOf(ctx);
    const holdings = valuedHoldings(ctx);
    const target = ctx.scope === 'instrument' ? ctx.scopeTarget?.toUpperCase() : undefined;
    const sectorNames = [
      ...new Set(
        (target ? [target] : holdings.map((holding) => holding.ticker))
          .map((ticker) => sectors.get(ticker))
          .filter((sector): sector is string => !!sector && sector !== UNKNOWN_SECTOR),
      ),
    ];

    // Разбор бумаги: упор на отчётность и мультипликаторы; портфель — на диверсификацию.
    const topics = knowledge.select({
      section: ctx.scope === 'instrument' ? 'securities' : 'verdict',
      sectors: sectorNames,
      required: ctx.scope === 'instrument' ? ['reporting', 'multiples', 'sector-dependencies'] : undefined,
      limit: 3,
    });
    if (topics.length === 0) {
      return undefined;
    }

    const summary = (topic: KnowledgeTopic): string => `${topic.title} — ${topic.summary}`;
    return {
      markdown: [
        formatKnowledgeBlock(topics),
        '',
        'Справочный контекст: принципы трактовки, а не данные рынка; числа — из фактов выше.',
      ].join('\n'),
      structured: topics.map((topic) => ({ id: topic.id, title: topic.title })),
      brief: topics.map(summary).join(' | ').slice(0, 1_500),
    };
  },
});
