import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { executePlan, type CollectionResult } from '../../../collection/executor.js';
import { buildCollectionPlan, instrumentKey, planKey, type CollectionPlan, type PlanEntry } from '../../../collection/plan.js';
import { assetEntries, brandEntries, shareEntries } from '../../../collection/reference.js';
import { loadTickerAliases, matchersFor } from '../../../news/news.aliases.js';
import type { AgentStateType } from '../../graph/state.js';
import type { ReviewDeps } from './deps.js';
import { instrumentsOf } from './instruments.js';

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
    const instruments = instrumentsOf(basePlan, first);
    // Разбор одной бумаги: остальные позиции только мешают — берём выбранный тикер.
    const scope = state.scope ?? 'portfolio';
    const scopeTarget = state.scopeTarget?.toUpperCase();
    const scoped =
      scope === 'instrument' && scopeTarget
        ? instruments.filter((instrument) => instrument.ticker.toUpperCase() === scopeTarget)
        : instruments;
    // Бумаги может не быть в портфеле: разбираем её по тикеру, отчёт честно
    // покажет, что позиции нет.
    const selected =
      scope === 'instrument' && scoped.length === 0 && state.scopeTarget
        ? [{ ticker: state.scopeTarget.toUpperCase() }]
        : scoped;
    const selectedInstruments = selected.length > 0 ? selected : instruments;
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
    let entries = perTicker.entries.filter(
      (entry) => perTickerGroups.has(entry.group) && !seen.has(planKey(entry)),
    );
    // В разборе одной бумаги долю и стоимость остальных позиций всё равно надо
    // знать: цены — один пакетный запрос на весь портфель.
    const allIds = instruments
      .map((instrument) => instrumentKey(instrument.ticker, instrument.classCode))
      .filter((id) => !ids.includes(id));
    if (scope === 'instrument' && allIds.length > 0) {
      const prices = {
        tool: 'invest_get_market_values',
        args: { instrumentId: [...ids, ...allIds] },
        group: 'prices' as const,
        priority: 'mandatory' as const,
      };
      entries = [prices, ...entries.filter((entry) => entry.group !== 'prices')];
    }
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

