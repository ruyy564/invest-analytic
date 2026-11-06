import type { ApprovePayload } from '../approval-flow.service.js';
import type { AgentStateType } from '../graph/state.js';

/** Лимит шагов графа (учитывает шаги цикла «модель ⇄ инструменты»). */
export const RUN_RECURSION_LIMIT = 12;

export interface RunReport {
  reportId: string;
  type: 'data_answer' | 'portfolio_report' | 'deep_review' | 'market_news';
  asOf: string;
  coverage: { source: string; status: 'ok' | 'missing'; reason?: string }[];
}

/** Метаданные новостной сводки: без `reportId`, она не сохраняется как отчёт. */
export interface NewsReport {
  type: 'market_news';
  asOf: string;
  coverage: { source: string; status: 'ok' | 'missing'; reason?: string }[];
}

export interface RunResult {
  /** Идентификатор прогона: связывает ответ, логи и журнал. */
  runId: string;
  status: 'completed' | 'awaiting_approval';
  answer?: string;
  intent: AgentStateType['intent'];
  /** Область разбора: весь портфель, счёт или отдельная бумага. */
  scope?: AgentStateType['scope'];
  scopeTarget?: string;
  scopeLabel?: string;
  partial: boolean;
  approval?: ApprovePayload;
  /** Метаданные отчёта: идентификатор для выгрузки, вид, время данных и покрытие. */
  report?: RunReport | NewsReport;
  /** Ссылка на трейс LangSmith, если трассировка включена. */
  traceUrl?: string;
}
