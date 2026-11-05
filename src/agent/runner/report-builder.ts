import type { AgentStateType } from '../graph/state.js';
import type { NewsReport, RunReport } from './runner.types.js';

/** Сохранение отчёта: сервис хранилища передаётся снаружи. */
export interface ReportSaver {
  save(report: {
    reportId: string;
    userId: string;
    createdAt: string;
    templateVersion: number;
    markdown: string;
    json: string;
  }): void;
}

const coverageOf = (values: AgentStateType | undefined) =>
  (values?.collection?.coverage ?? []).map(({ source, status, reason }) => ({
    source,
    status,
    reason,
  }));

/** Метаданные новостной сводки: без `reportId`, она не сохраняется как отчёт. */
export const newsReportOf = (values: AgentStateType | undefined): NewsReport | undefined => {
  if (values?.reportType !== 'market_news') {
    return undefined;
  }
  return {
    type: 'market_news',
    asOf: values.dataAsOf ?? new Date().toISOString(),
    coverage: coverageOf(values),
  };
};

/** Метаданные отчёта; сохранение — чтобы работала выгрузка по `reportId`. */
export const reportOf = (
  values: AgentStateType | undefined,
  answer: string | undefined,
  options: { reports: ReportSaver; userId: string },
): RunReport | undefined => {
  const reportId = values?.reportId;
  if (!reportId) {
    return undefined;
  }
  const report: RunReport = {
    reportId,
    type: values?.reportType ?? 'deep_review',
    asOf: values?.dataAsOf ?? new Date().toISOString(),
    coverage: coverageOf(values),
  };

  if (answer) {
    options.reports.save({
      reportId,
      userId: options.userId,
      createdAt: new Date().toISOString(),
      templateVersion: values?.reportTemplateVersion ?? 0,
      markdown: answer,
      json: JSON.stringify({ report, answer }),
    });
  }
  return report;
};
