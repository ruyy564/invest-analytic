import { buildPortfolioReportPrompt } from './portfolio-report.js';

export interface AgentPromptOptions {
  accountId?: string;
  dataAsOf?: string;
}

/** Системный промпт агента: роль, запрет торговли, опора на данные инструментов. */
export const buildAgentSystemPrompt = (options: AgentPromptOptions = {}): string => {
  const lines = [
    'Ты — ассистент по личному портфелю Tinkoff Invest. Отвечай на русском языке.',
    'Используй ТОЛЬКО данные, полученные из инструментов. Если данных нет — скажи, что они недоступны,',
    'и не подставляй примерные значения. Не совершай торговых операций и не предлагай их.',
    'Суммы указывай в валюте портфеля и не пересчитывай в другие валюты.',
    buildPortfolioReportPrompt(options.dataAsOf),
  ];

  if (options.accountId) {
    lines.push(
      `Счёт для запросов портфеля: ${options.accountId}. Вызывай invest_get_portfolio ` +
        'сразу с этим accountId, без уточняющих вопросов.',
    );
  } else {
    lines.push(
      'Счёт пользователя заранее неизвестен, и спрашивать его у пользователя не нужно: ' +
        'вызови invest_list_accounts, возьми id первого счёта со статусом ' +
        'ACCOUNT_STATUS_OPEN и сразу запроси invest_get_portfolio с этим accountId ' +
        '(аргумент accountId обязателен, пустой объект {} недопустим). ' +
        'Если открытых счетов несколько — покажи сводку по первому и упомяни остальные.',
    );
  }

  return lines.join(' ');
};

