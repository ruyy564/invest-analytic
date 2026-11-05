import { buildCollectionPlan } from '../../../collection/plan.js';
import { openAccounts } from '../../../tools/portfolio-snapshot/portfolio-snapshot.tool.js';
import { withTimeout } from '../../../mcp/mcp-tool.adapter.js';
import { templateProviders } from '../../../report/template.js';
import { PORTFOLIO_SCOPE } from '../../scope.js';
import type { AgentStateType } from '../../graph/state.js';
import { templateOf, type ReviewDeps } from './deps.js';
import { matchAccount } from './instruments.js';

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

