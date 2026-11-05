import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { executePlan, type CollectionResult } from '../../../collection/executor.js';
import { buildCollectionPlan, instrumentKey, planKey, type CollectionPlan, type PlanEntry } from '../../../collection/plan.js';
import { assetEntries, brandEntries, shareEntries } from '../../../collection/reference.js';
import { loadTickerAliases, matchersFor } from '../../../news/news.aliases.js';
import type { AgentStateType } from '../../graph/state.js';
import type { ReviewDeps } from './deps.js';
import { instrumentsOf, instrumentFromSearch } from './instruments.js';

export const createCollectNode =
  (deps: ReviewDeps) =>
  async (
    state: AgentStateType,
    config?: LangGraphRunnableConfig,
  ): Promise<Partial<AgentStateType>> => {
    const sessionId = String(config?.configurable?.thread_id ?? '');
    const budget = deps.registry.budgetOf(sessionId) ?? deps.registry.createBudget();
    const executeDeps = {
      tool: (name: string) => deps.registry.toolByName(name),
      budget,
      parallelism: deps.config.value.run.parallelism,
      timeoutMs: deps.config.value.run.mcpToolTimeoutMs,
    };

    const basePlan: CollectionPlan = {
      entries: state.readingPlan as PlanEntry[],
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
    };
    const first = await executePlan(basePlan, executeDeps);

    // Вторая фаза: только то, что нельзя было спланировать до чтения позиций —
    // цены, пери-тикерная аналитика, новости по бумагам и справочник секторов.
    // Уже выполненные запросы первой фазы не повторяем: бюджет прогона общий.
    const scope = state.scope ?? 'portfolio';
    const scopeTarget = state.scopeTarget?.toUpperCase();
    const instruments = instrumentsOf(basePlan, first);
    // Разбор бумаги портфель не читает: тикер и класс берём из `invest_find_instrument`.
    const selectedInstruments =
      scope === 'instrument' && scopeTarget
        ? [instrumentFromSearch(basePlan, first, scopeTarget) ?? { ticker: scopeTarget }]
        : instruments;
    // Алиасы эмитентов: в новостях бумагу чаще называют по имени, а не по тикеру.
    const aliases = loadTickerAliases(deps.config.value.sources.tickerAliasesFile);
    // Для запросов MCP передаём `TICKER_CLASSCODE`: по одному тикеру брокер
    // отвечает «Instrument not found» (AGRO, SBER есть в разных режимах торгов).
    const ids = selectedInstruments.map((instrument) =>
      instrumentKey(instrument.ticker, instrument.classCode),
    );
    const perTicker = buildCollectionPlan({
      accounts: [],
      tickers: ids,
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
      providers: ['securities.detail', 'securities.opinions'],
      // Подстроки для лент: тикер, название из позиции и алиасы эмитента.
      matchers: Object.fromEntries(
        selectedInstruments.map((instrument) => [
          instrument.ticker,
          matchersFor(instrument, aliases),
        ] as const),
      ),
    });
    const perTickerGroups = new Set(['prices', 'candles', 'analytics', 'dividends', 'news']);
    const seen = new Set(first.results.keys());
    const entries = perTicker.entries.filter(
      (entry) => perTickerGroups.has(entry.group) && !seen.has(planKey(entry)),
    );
    const phase2: CollectionPlan = {
      entries,
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
    };
    const second = await executePlan(phase2, executeDeps);

    const results: Record<string, string> = Object.fromEntries(first.results);
    for (const [key, value] of second.results) {
      results[key] = value;
    }

    // Справочник секторов: share → asset → brand, каждый круг по ответам предыдущего.
    const texts = new Map<string, string>([...first.results, ...second.results]);
    const referencePlans: CollectionPlan[] = [];
    const extraCoverage = [...second.coverage];
    let extraPartial = second.partial;

    const round = async (entries: PlanEntry[]): Promise<PlanEntry[]> => {
      if (entries.length === 0) {
        return [];
      }
      const plan: CollectionPlan = {
        entries,
        maxInstruments: deps.config.value.run.reviewMaxInstruments,
      };
      const outcome = await executePlan(plan, executeDeps);
      referencePlans.push(plan);
      extraCoverage.push(...outcome.coverage);
      extraPartial = extraPartial || outcome.partial;
      for (const [key, value] of outcome.results) {
        results[key] = value;
        texts.set(key, value);
      }
      return entries;
    };

    const shares = await round(shareEntries(selectedInstruments));
    const assets = await round(assetEntries(shares, texts, planKey));
    await round(brandEntries(assets, texts, planKey));

    return {
      readingPlan: [...basePlan.entries, ...phase2.entries, ...referencePlans.flatMap((plan) => plan.entries)],
      collection: {
        results,
        coverage: [...first.coverage, ...extraCoverage],
        partial: first.partial || extraPartial,
      },
      partial: first.partial || extraPartial,
      dataAsOf: new Date().toISOString(),
    };
  };

/** Восстановление результатов сбора из состояния (Map не сериализуется в чекпоинт). */
export const collectionFromState = (state: AgentStateType): CollectionResult => ({
  results: new Map(Object.entries(state.collection?.results ?? {})),
  coverage: state.collection?.coverage ?? [],
  partial: state.collection?.partial ?? false,
});

