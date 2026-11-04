import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
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
  type CollectionPlan,
  type PlanEntry,
} from '../../collection/plan.js';
import { assetEntries, brandEntries, shareEntries } from '../../collection/reference.js';
import { loadTickerAliases, matchersFor } from '../../sources/aliases.js';
import { PORTFOLIO_SCOPE } from '../scope.js';
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
import type { AgentStateType } from '../graph/state.js';

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
/** Инструменты из собранных позиций: тикер, класс, название и uid актива. */
export const instrumentsOf = (
  plan: CollectionPlan,
  collected: CollectionResult,
): { ticker: string; classCode?: string; uid?: string; name?: string }[] => {
  const found = new Map<string, { ticker: string; classCode?: string; uid?: string; name?: string }>();
  for (const { text } of resultsInGroup(plan, collected, 'portfolio')) {
    try {
      for (const position of mapPositions(text, 'rub')) {
        found.set(position.instrument.ticker, {
          ticker: position.instrument.ticker,
          classCode: position.instrument.classCode,
          uid: position.instrument.uid,
          name: position.instrument.name,
        });
      }
    } catch {
      // Счёт без позиций или нечитаемый ответ: остальные всё равно разберём.
    }
  }
  return [...found.values()];
};

/** Открытые счета с названиями: нужны для разбора конкретного счёта. */
const openAccountList = async (
  deps: ReviewDeps,
): Promise<{ accountId: string; title?: string }[]> => {
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
    return openAccounts(raw);
  } catch {
    return [];
  }
};

/** Счёт по номеру или названию: точное совпадение, подстрока, название. */
export const matchAccount = <T extends { accountId: string; title?: string }>(
  accounts: readonly T[],
  target: string,
): T | undefined => {
  const wanted = target.trim().toLowerCase();
  if (wanted.length === 0) {
    return undefined;
  }
  return (
    accounts.find((account) => account.accountId === target) ??
    accounts.find((account) => account.accountId.includes(wanted)) ??
    accounts.find((account) => (account.title ?? '').toLowerCase().includes(wanted))
  );
};

/** Узел плана: счета и обязательные источники, подтверждается одним запросом. */
export const createPlanNode =
  (deps: ReviewDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const scope = state.scope ?? 'portfolio';
    const accounts = await openAccountList(deps);
    let selected = accounts.map((account) => account.accountId);
    let scopeLabel = scope === 'account' ? 'счёта' : PORTFOLIO_SCOPE.label;

    if (scope === 'account') {
      const found = state.scopeTarget ? matchAccount(accounts, state.scopeTarget) : undefined;
      if (found) {
        selected = [found.accountId];
        scopeLabel = `счёта ${found.title ?? found.accountId}`;
      } else {
        // Счёт не нашли — не молчим: разбираем весь портфель с явной подписью.
        scopeLabel = 'портфеля (указанный счёт не найден)';
      }
    } else if (scope === 'instrument') {
      scopeLabel = state.scopeTarget ? `бумаги ${state.scopeTarget}` : 'бумаги';
    }

    const plan = buildCollectionPlan({
      accounts: selected,
      tickers: [],
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
      // Состав поставщиков зависит от области: разбору бумаги не нужны налоги и пробелы.
      providers: templateProviders(template, scope),
    });

    return {
      readingPlan: plan.entries,
      scope,
      scopeTarget: state.scopeTarget,
      scopeLabel,
      dataAsOf: new Date().toISOString(),
    };
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

/** Промпт интерпретации: файл `reports/prompts/interpretation.md` или встроенный. */
export const INTERPRETATION_FALLBACK = [
  'Ты пишешь один раздел отчёта по портфелю частного инвестора: макро и цикл, оценку бумаг и секторов или итог по диверсификации и стратегии.',
  'Опирайся ТОЛЬКО на факты брифинга: числа, ставки, цены и события не придумывай.',
  'Если факта нет — пиши «данных нет», а не оценку. Оценки помечай словом (оценка).',
  'Отвечай по-русски, верни только текст раздела: без заголовков markdown и без префикса с кодом раздела.',
].join(' ');

export const loadInterpretationPrompt = (path: string): string => {
  try {
    return readFileSync(path, 'utf8').trim() || INTERPRETATION_FALLBACK;
  } catch {
    return INTERPRETATION_FALLBACK;
  }
};

/** Интерпретация идёт отдельными вызовами: разделов три, ответа ждём до минуты. */
export const INTERPRETATION_TIMEOUT_MS = 60_000;

/**
 * Ответ модели на конкретный раздел: снимаем заголовок и префикс `id:`.
 * Раздел уже подписан шаблоном, дублировать имя не нужно.
 */
export const cleanSection = (text: string, id: string): string =>
  text
    .replace(/^\s*#+\s+.*(\r?\n|$)/, '')
    .replace(new RegExp(`^\\s*[*_#>-]*\\s*${id}\\s*[*_]*\\s*[:\\-—]\\s*`, 'i'), '')
    .trim();

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
      scope: state.scope ?? 'portfolio',
      scopeTarget: state.scopeTarget,
    });

    const interpretation: Record<string, string> = {};
    if (report.interpretation.length > 0 && deps.model) {
      const prompt = loadInterpretationPrompt(deps.config.value.report.interpretationPromptFile);
      // По вызову на раздел: модель отвечает свободным текстом, а не разметкой
      // «macro: …». Вызовы идут последовательно — GigaChat не любит параллель.
      for (const request of report.interpretation) {
        const instructions = [
          prompt,
          `Сейчас ты пишешь только раздел «${request.title}» (код раздела: ${request.id}).`,
          'Верни только текст раздела: без заголовков markdown и без префикса с кодом раздела.',
        ].join('\n');
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            const response = await withTimeout(
              deps.model?.invoke([
                new SystemMessage(instructions),
                new HumanMessage(request.brief),
              ]) ?? Promise.reject(new Error('модель недоступна')),
              INTERPRETATION_TIMEOUT_MS,
              () => new Error('llm timeout'),
            );
            const text = typeof response.content === 'string' ? response.content : '';
            const cleaned = cleanSection(text, request.id);
            if (cleaned.length > 0) {
              interpretation[request.id] = cleaned;
              break;
            }
            console.warn(`[report] раздел ${request.id}: пустой ответ модели`);
          } catch (error) {
            const message = error instanceof Error ? error.message : JSON.stringify(error);
            console.warn(`[report] раздел ${request.id} не сформирован:`, message.slice(0, 200));
            // Одна повторная попытка: сеть и лимиты модели дают сбои на короткое время.
            await new Promise((resolve) => setTimeout(resolve, 800));
          }
        }
      }
    }

    const markdown = composeMarkdown(report, interpretation, state.scopeLabel);
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
