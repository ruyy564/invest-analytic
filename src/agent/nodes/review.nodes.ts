import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, SystemMessage } from '@langchain/core/messages';
import type { LangGraphRunnableConfig } from '@langchain/langgraph';
import { readFileSync } from 'node:fs';
import type { AppConfigService } from '../../config/app-config.service.js';
import {
  executePlan,
  resultsInGroup,
  type CollectionResult,
} from '../../collection/executor.js';
import {
  buildCollectionPlan,
  instrumentKey,
  planKey,
  sectorEntries,
  type CollectionPlan,
  type PlanEntry,
} from '../../collection/plan.js';
import { mapPositions } from '../../tools/mappers/positions.mapper.js';
import type { McpRegistryService } from '../../tools/mcp-registry.service.js';
import { openAccounts } from '../../tools/portfolio-snapshot.js';
import { withTimeout } from '../../tools/mcp-tool.adapter.js';
import { buildReport, composeMarkdown, type ReportBuildResult } from '../../report/engine.js';
import { createProviderMap } from '../../report/providers/index.js';
import {
  loadReportTemplate,
  templateProviders,
  type ReportTemplate,
} from '../../report/template.js';
import { sectorLookup } from '../../report/sector.js';
import type { AgentStateType } from '../graph/state.js';
import { ANSWER_TIMEOUT_MS } from './agent.node.js';

export interface ReviewDeps {
  config: AppConfigService;
  registry: McpRegistryService;
  model?: BaseChatModel;
  /** Шаблон читается один раз: файл не должен меняться в середине прогона. */
  template?: ReportTemplate;
}

const templateOf = (deps: ReviewDeps): ReportTemplate =>
  deps.template ?? loadReportTemplate(deps.config.value.report.templateFile);

/** Открытые счета для плана: служебное чтение без подтверждения. */
const accountIds = async (deps: ReviewDeps): Promise<string[]> => {
  const tool = deps.registry.toolByName('invest_list_accounts');
  if (!tool) {
    return [];
  }
  try {
    const raw = await withTimeout(
      tool.invoke({} as never),
      deps.config.value.run.mcpToolTimeoutMs,
      () => new Error('таймаут списка счетов'),
    );
    return openAccounts(raw).map((account) => account.accountId);
  } catch {
    return [];
  }
};

/** Инструменты из собранных позиций: тикер, класс и uid актива (для справочника). */
export const instrumentsOf = (
  plan: CollectionPlan,
  collected: CollectionResult,
): { ticker: string; classCode?: string; uid?: string }[] => {
  const found = new Map<string, { ticker: string; classCode?: string; uid?: string }>();
  for (const { text } of resultsInGroup(plan, collected, 'portfolio')) {
    try {
      for (const position of mapPositions(text, 'rub')) {
        found.set(position.instrument.ticker, {
          ticker: position.instrument.ticker,
          classCode: position.instrument.classCode,
          uid: position.instrument.uid,
        });
      }
    } catch {
      // Счёт без позиций или нечитаемый ответ: остальные всё равно разберём.
    }
  }
  return [...found.values()];
};

/** Узел плана: счета и обязательные источники, подтверждается одним запросом. */
export const createPlanNode =
  (deps: ReviewDeps) =>
  async (_state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const accounts = await accountIds(deps);
    const plan = buildCollectionPlan({
      accounts,
      tickers: [],
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
      providers: templateProviders(template),
    });

    return { readingPlan: plan.entries, dataAsOf: new Date().toISOString() };
  };


/** Узел сбора: исполняет подтверждённый план, затем добавляет аналитику по бумагам. */
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
    // Для запросов MCP передаём `TICKER_CLASSCODE`: по одному тикеру брокер
    // отвечает «Instrument not found» (AGRO, SBER есть в разных режимах торгов).
    const ids = instruments.map((instrument) =>
      instrumentKey(instrument.ticker, instrument.classCode),
    );
    const perTicker = buildCollectionPlan({
      accounts: [],
      tickers: ids,
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
      providers: ['market.dynamics', 'market.analytics', 'news.digest'],
    });
    const perTickerGroups = new Set([
      'prices',
      'candles',
      'analytics',
      'dividends',
      'signals',
      'news',
    ]);
    const seen = new Set(first.results.keys());
    const phase2: CollectionPlan = {
      entries: [
        ...perTicker.entries.filter((entry) => perTickerGroups.has(entry.group)),
        ...sectorEntries(instruments),
      ].filter((entry) => !seen.has(planKey(entry))),
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
    };
    const second = await executePlan(phase2, executeDeps);

    // Добор секторов через бренд: справочник бумаги не всегда содержит сектор,
    // но отдаёт `brand.uid` — сектор есть в ответе `invest_get_brand`.
    const results: Record<string, string> = Object.fromEntries(first.results);
    for (const [key, value] of second.results) {
      results[key] = value;
    }

    const referenceSeen = new Map([...first.results, ...second.results]);
    const lookup = sectorLookup(
      phase2.entries
        .filter((entry) => entry.group === 'reference')
        .flatMap((entry) => {
          const text = referenceSeen.get(planKey(entry));
          return text === undefined ? [] : [{ target: entry.target, text }];
        }),
    );
    const brandEntries: PlanEntry[] = [...lookup.brandByTicker]
      .filter(([ticker]) => !lookup.byTicker.has(ticker))
      .map(([ticker, brandUid]) => ({
        tool: 'invest_get_brand',
        args: { brandUid },
        group: 'reference' as PlanEntry['group'],
        priority: 'optional' as PlanEntry['priority'],
        target: ticker,
      }));
    const third = brandEntries.length
      ? await executePlan(
          { entries: brandEntries, maxInstruments: deps.config.value.run.reviewMaxInstruments },
          executeDeps,
        )
      : { results: new Map<string, string>(), coverage: [], partial: false };
    for (const [key, value] of third.results) {
      results[key] = value;
    }

    return {
      readingPlan: [...basePlan.entries, ...phase2.entries],
      collection: {
        results,
        coverage: [...first.coverage, ...second.coverage],
        partial: first.partial || second.partial,
      },
      partial: first.partial || second.partial,
      dataAsOf: new Date().toISOString(),
    };
  };

/** Восстановление результатов сбора из состояния (Map не сериализуется в чекпоинт). */
export const collectionFromState = (state: AgentStateType): CollectionResult => ({
  results: new Map(Object.entries(state.collection?.results ?? {})),
  coverage: state.collection?.coverage ?? [],
  partial: state.collection?.partial ?? false,
});

/** Промпт интерпретации: файл `reports/prompts/interpretation.md` или встроенный. */
export const INTERPRETATION_FALLBACK = [
  'Ты пишешь два раздела отчёта по портфелю: «рыночный контекст и макро» и «итог и совет».',
  'Опирайся ТОЛЬКО на факты в брифинге. Не придумывай числа, ставки, цены и события.',
  'Фазу цикла и привлекательность секторов помечай словом (оценка).',
  'Совет давай в терминах классов активов и долей; не предлагай конкретные сделки.',
  'Формат ответа: две строки вида `macro: …` и `verdict: …`, без заголовков и списков.',
].join(' ');

export const loadInterpretationPrompt = (path: string): string => {
  try {
    return readFileSync(path, 'utf8').trim() || INTERPRETATION_FALLBACK;
  } catch {
    return INTERPRETATION_FALLBACK;
  }
};

/** Разбор ответа модели: строки `id: текст` для секций интерпретации. */
export const parseInterpretation = (
  text: string,
  ids: readonly string[],
): Record<string, string> => {
  const result: Record<string, string> = {};
  const lines = text.split(/\r?\n/);
  for (const id of ids) {
    const pattern = new RegExp(`^\\s*${id}\\s*:`, 'i');
    const line = lines.find((candidate) => pattern.test(candidate));
    if (line) {
      const value = line.replace(pattern, '').trim();
      if (value.length > 0) {
        result[id] = value;
      }
    }
  }
  if (Object.keys(result).length === 0 && text.trim().length > 0 && ids.length === 1) {
    result[ids[0]] = text.trim();
  }
  return result;
};

/** Узел отчёта: сборка по шаблону + один вызов модели на интерпретацию. */
export const createReportNode =
  (deps: ReviewDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const collected = collectionFromState(state);

    const report = buildReport({
      template,
      providers: createProviderMap(),
      plan: {
        entries: state.readingPlan as PlanEntry[],
        maxInstruments: deps.config.value.run.reviewMaxInstruments,
      },
      collected,
    });

    let interpretation: Record<string, string> = {};
    if (report.interpretation.length > 0 && deps.model) {
      try {
        const prompt = loadInterpretationPrompt(deps.config.value.report.interpretationPromptFile);
        const brief = report.interpretation
          .map((request) => `## ${request.id} (${request.title})\n${request.brief}`)
          .join('\n\n');
        const response = await withTimeout(
          deps.model.invoke([new SystemMessage(prompt), new AIMessage(brief)]),
          ANSWER_TIMEOUT_MS,
          () => new Error('llm timeout'),
        );
        const text = typeof response.content === 'string' ? response.content : '';
        interpretation = parseInterpretation(
          text,
          report.interpretation.map((request) => request.id),
        );
      } catch {
        // Без интерпретации отчёт остаётся частичным, но остаётся отчётом.
      }
    }

    const markdown = composeMarkdown(report, interpretation);
    const partial =
      report.partial || Object.keys(interpretation).length < report.interpretation.length;

    return {
      messages: [new AIMessage(markdown)],
      reportId: report.reportId,
      reportTemplateVersion: report.templateVersion,
      reportType: 'deep_review',
      partial,
      dataAsOf: report.asOf,
    };
  };

export type { ReportBuildResult };
