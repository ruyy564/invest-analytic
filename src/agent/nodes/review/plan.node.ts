import { buildCollectionPlan } from '../../../capabilities/reports/collection/plan.js';
import { openAccounts } from '../../../capabilities/portfolio/tools/portfolio-snapshot/portfolio-snapshot.service.js';
import { withTimeout } from '../../../transports/mcp/mcp-tool.adapter.js';
import { templateProviders } from '../../../capabilities/reports/template.js';
import { PORTFOLIO_SCOPE } from '../../scope.js';
import type { AgentStateType } from '../../graph/state.js';
import { templateOf, type ReviewDeps } from './deps.js';
import { matchAccount } from './instruments.js';
import { MCP_CAPABILITIES, mergePlan, planWithModel, validatePlan } from '../../planning/index.js';

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



export const createPlanNode =
  (deps: ReviewDeps) =>
  async (state: AgentStateType): Promise<Partial<AgentStateType>> => {
    const template = templateOf(deps);
    const scope = state.scope ?? 'portfolio';

    // Разбор бумаги не читает портфель: ни счета, ни позиции, ни стоимость не нужны.
    // Сначала один запрос `find_instrument` — по нему узнаём класс бумаги (TQBR/TQOB),
    // затем обычный план по тикеру: цена, свечи, прогноз, дивиденды, новости.
    if (scope === 'instrument' && state.scopeTarget) {
      const plan = buildCollectionPlan({
        accounts: [],
        tickers: [],
        maxInstruments: deps.config.value.run.reviewMaxInstruments,
        providers: templateProviders(template, scope),
      });
      return {
        readingPlan: [
          {
            tool: 'invest_find_instrument',
            args: { query: state.scopeTarget },
            group: 'reference',
            priority: 'mandatory',
          },
          ...plan.entries,
        ],
        scope,
        scopeTarget: state.scopeTarget,
        scopeLabel: `бумаги ${state.scopeTarget}`,
        dataAsOf: new Date().toISOString(),
      };
    }

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
    }

    const plan = buildCollectionPlan({
      accounts: selected,
      tickers: [],
      maxInstruments: deps.config.value.run.reviewMaxInstruments,
      // Состав поставщиков зависит от области: разбору бумаги не нужны налоги и пробелы.
      providers: templateProviders(template, scope),
    });

    // Агентский режим: модель предлагает недостающие запросы, обязательные
    // источники сценария остаются в плане — отчёт не теряет полноту.
    let entries = plan.entries;
    if (deps.config.value.run.agentMode === 'agent' && deps.model) {
      const question =
        [...state.messages]
          .reverse()
          .find((message) => (message as { _getType?: () => string })._getType?.() === 'human')
          ?.content;
      const planned = await planWithModel({
        model: deps.model,
        question: typeof question === 'string' ? question : 'разбор портфеля',
        capabilities: MCP_CAPABILITIES,
        // Безопасный фолбэк: пустой список — план остаётся детерминированным.
        fallback: () => ({ steps: [], source: 'fallback' }),
      });
      entries = mergePlan(plan, validatePlan({ steps: planned.steps }, MCP_CAPABILITIES).steps)
        .entries;
    }

    return {
      readingPlan: entries,
      scope,
      scopeTarget: state.scopeTarget,
      scopeLabel,
      dataAsOf: new Date().toISOString(),
    };
  };

