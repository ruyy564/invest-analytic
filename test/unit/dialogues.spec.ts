import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { planKey, type CollectionPlan } from '../../src/collection/plan.js';
import { buildReport, type FactContext } from '../../src/report/engine.js';
import { composeMarkdown } from '../../src/report/compose.js';
import { createProviderMap } from '../../src/report/providers/index.js';
import { loadCompanyProfiles } from '../../src/report/company-profiles.js';
import { loadReportTemplate } from '../../src/report/template.js';
import { detectScope } from '../../src/agent/scope.js';
import {
  KNOWLEDGE_QUESTION_PATTERN,
  KnowledgeRepository,
  KnowledgeService,
} from '../../src/knowledge/index.js';
import { CAPABILITIES_PATTERN } from '../../src/agent/nodes/help/capabilities.js';
import {
  heuristicIntent,
  heuristicNewsIntent,
  type Intent,
} from '../../src/agent/nodes/classify/prompt.js';
import { loadTickerAliases } from '../../src/news/news.aliases.js';
import type { AppConfigService } from '../../src/config/app-config.service.js';

interface Dialogue {
  id: string;
  question: string;
  resolvedBy: 'rule' | 'llm';
  intent?: Intent['intent'];
  scope: 'portfolio' | 'account' | 'instrument';
  target?: string;
  answer?: { mustContain?: string[]; mustNotContain?: string[] };
}

const DIALOGUES: Dialogue[] = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'fixtures', 'dialogues.json'), 'utf8'),
) as Dialogue[];

const ALIASES = loadTickerAliases('data/ticker-aliases.yaml');
const TEMPLATE_PATH = 'reports/portfolio-review.yaml';
const PROFILES = loadCompanyProfiles('data/company-profiles.yaml');

const knowledge = new KnowledgeService(
  new KnowledgeRepository({
    value: {
      run: {
        knowledgeEnabled: true,
        knowledgeDir: join(process.cwd(), 'data', 'knowledge'),
        knowledgeFile: undefined,
        knowledgeMaxChars: 1_800,
      },
    },
  } as unknown as AppConfigService),
);

const NOW = new Date('2026-11-05T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

/** Маршрут вопроса теми же правилами, что и в узле классификации. */
const routeOf = (
  dialogue: Dialogue,
): { intent?: Intent['intent']; scope: string; target?: string } => {
  const scoped = detectScope(dialogue.question, ALIASES);
  if (CAPABILITIES_PATTERN.test(dialogue.question)) {
    return { intent: 'agent_help', ...scoped };
  }
  if (
    KNOWLEDGE_QUESTION_PATTERN.test(dialogue.question) &&
    knowledge.topicFor(dialogue.question)
  ) {
    return { intent: 'knowledge_question', ...scoped };
  }
  const heuristic = heuristicIntent(dialogue.question, scoped.scope);
  if (heuristic) {
    return { intent: heuristic.intent, ...scoped };
  }
  if (heuristicNewsIntent(dialogue.question, scoped.scope)) {
    return { intent: 'market_news', ...scoped };
  }
  return { ...scoped };
};

describe('корзина диалогов: маршрутизация', () => {
  for (const dialogue of DIALOGUES) {
    it(`${dialogue.id}: «${dialogue.question}»`, () => {
      const route = routeOf(dialogue);

      expect(route.scope).toBe(dialogue.scope);
      if (dialogue.target) {
        expect(route.target).toBe(dialogue.target);
      }
      if (dialogue.resolvedBy === 'rule' && dialogue.intent) {
        expect(route.intent).toBe(dialogue.intent);
      }
    });
  }
});

/** Контекст разбора бумаги: портфель не читается, только данные тикера. */
const instrumentContext = (ticker: string, sector: string): FactContext => {
  const plan: CollectionPlan = {
    entries: [
      { tool: 'invest_get_market_values', args: { instrumentId: [`${ticker}_TQBR`] }, group: 'prices', priority: 'mandatory' },
      { tool: 'invest_get_candles', args: { instrumentId: `${ticker}_TQBR` }, group: 'candles', priority: 'optional', target: ticker },
      { tool: 'invest_get_share', args: { instrumentId: `${ticker}_TQBR` }, group: 'reference', priority: 'optional', target: ticker },
      { tool: 'invest_get_insider_deals', args: { instrumentId: `${ticker}_TQBR` }, group: 'insiders', priority: 'optional', target: ticker },
      { tool: 'market__news_digest', args: { days: 7 }, group: 'market_news', priority: 'optional' },
      { tool: 'market__news_digest', args: { tickers: [ticker] }, group: 'news', priority: 'mandatory', target: ticker },
    ],
    maxInstruments: 5,
  };
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_market_values') {
      results.set(
        planKey(entry),
        JSON.stringify({
          instruments: [
            {
              ticker,
              classCode: 'TQBR',
              priceCurrency: 'rub',
              values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '1000' } }],
            },
          ],
        }),
      );
    }
    if (entry.tool === 'invest_get_candles') {
      results.set(
        planKey(entry),
        JSON.stringify({
          priceCurrency: 'rub',
          candles: [
            { time: iso(120), close: { value: '1200' } },
            { time: iso(30), close: { value: '980' } },
            { time: iso(0), close: { value: '1000' } },
          ],
        }),
      );
    }
    if (entry.tool === 'invest_get_share') {
      results.set(planKey(entry), JSON.stringify({ sector }));
    }
    if (entry.group === 'insiders') {
      results.set(
        planKey(entry),
        JSON.stringify({
          insiderDeals: [
            {
              date: '2025-12-11',
              direction: 'TRADE_DIRECTION_SELL',
              currency: 'RUR',
              quantity: '216732',
              price: { value: '307.19' },
              investorName: 'Анонимный инвестор',
              investorPosition: 'Подконтрольная эмитенту организация',
            },
          ],
        }),
      );
    }
    if (entry.group === 'market_news') {
      results.set(
        planKey(entry),
        'Новости за неделю:' +
          '\n• 2026-11-05 [rbc] ЦБ сохранил ставку 14 %' +
          '\n• 2026-11-05 [tass] Индекс Мосбиржи вырос на 1,2 %',
      );
    }
    if (entry.group === 'news') {
      results.set(planKey(entry), `Новости по тикеру:\n• 2026-11-05 [tinkoff] ${ticker}: новость по бумаге`);
    }
  }
  return {
    plan,
    collected: { results, coverage: [], partial: false },
    template: loadReportTemplate(TEMPLATE_PATH),
    now: NOW,
    scope: 'instrument',
    scopeTarget: ticker,
  };
};

/** Контекст разбора портфеля: одна бумага, чтобы проверить состав и справочный блок. */
const portfolioContext = (): FactContext => {
  const plan: CollectionPlan = {
    entries: [
      { tool: 'invest_get_portfolio', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
      { tool: 'invest_get_positions', args: { accountId: 'a' }, group: 'portfolio', priority: 'mandatory' },
      { tool: 'invest_get_market_values', args: {}, group: 'prices', priority: 'mandatory' },
      { tool: 'invest_get_share', args: { instrumentId: 'SBER_TQBR' }, group: 'reference', priority: 'optional', target: 'SBER' },
    ],
    maxInstruments: 5,
  };
  const results = new Map<string, string>();
  for (const entry of plan.entries) {
    if (entry.tool === 'invest_get_portfolio') {
      results.set(planKey(entry), JSON.stringify({ totalAmountCurrencies: [{ currency: 'rub', units: '100000' }] }));
    }
    if (entry.tool === 'invest_get_positions') {
      results.set(planKey(entry), JSON.stringify({ securities: [{ balance: '100', ticker: 'SBER', classCode: 'TQBR' }] }));
    }
    if (entry.tool === 'invest_get_market_values') {
      results.set(
        planKey(entry),
        JSON.stringify({
          instruments: [
            {
              ticker: 'SBER',
              classCode: 'TQBR',
              priceCurrency: 'rub',
              values: [{ type: 'INSTRUMENT_VALUE_LAST_PRICE', value: { currency: 'rub', value: '300' } }],
            },
          ],
        }),
      );
    }
    if (entry.tool === 'invest_get_share') {
      results.set(planKey(entry), JSON.stringify({ sector: 'financial' }));
    }
  }
  return {
    plan,
    collected: { results, coverage: [], partial: false },
    template: loadReportTemplate(TEMPLATE_PATH),
    now: NOW,
    scope: 'portfolio',
  };
};

describe('корзина диалогов: эталонный ответ', () => {
  for (const dialogue of DIALOGUES) {
    if (!dialogue.answer) {
      continue;
    }
    it(`${dialogue.id}: нужное есть, лишнего нет`, () => {
      const context =
        dialogue.scope === 'instrument' && dialogue.target
          ? instrumentContext(
              dialogue.target,
              dialogue.target === 'SBER' ? 'financial' : 'materials',
            )
          : portfolioContext();
      const report = buildReport({
        template: loadReportTemplate(TEMPLATE_PATH),
        providers: createProviderMap({ profiles: PROFILES }),
        plan: context.plan,
        collected: context.collected,
        scope: context.scope,
        scopeTarget: context.scopeTarget,
        now: NOW,
        reportId: `dialogue-${dialogue.id}`,
      });
      const label = dialogue.scope === 'instrument' ? `бумаги ${dialogue.target}` : undefined;
      const markdown = composeMarkdown(report, {}, label);

      for (const fragment of dialogue.answer.mustContain ?? []) {
        expect(markdown).toContain(fragment);
      }
      for (const fragment of dialogue.answer.mustNotContain ?? []) {
        expect(markdown).not.toContain(fragment);
      }
    });
  }
});

