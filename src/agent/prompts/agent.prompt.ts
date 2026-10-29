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
    lines.push(`Счёт для запросов портфеля: ${options.accountId}.`);
  } else {
    lines.push(
      'Если счёт неизвестен, сначала узнай список счетов инструментом invest_list_accounts, ' +
        'затем запрашивай портфель по нужному счёту.',
    );
  }

  return lines.join(' ');
};

