import type { Portfolio } from '../../shared/parsing/mappers/portfolio.mapper.js';
import {
  DATA_SOURCE,
  DISCLAIMER,
  UNAVAILABLE,
  formatDataAsOf,
  formatMoney,
  formatNumber,
} from './format.js';
import {
  formatPortfolioPosition,
  formatPosition,
  isQuantityOnly,
} from './position-format.js';


export interface ReportOptions {
  dataAsOf: string;
  now?: Date;
}

/**
 * Детерминированная сводка по портфелю: числа считает код, а не модель.
 * Пустой портфель, недоступные позиции и недоступные значения помечаются явно.
 */
export const formatPortfolioReport = (
  portfolio: Portfolio,
  options: ReportOptions,
): string => {
  const lines: string[] = [];

  if (portfolio.positionsUnavailable) {
    // У счёта есть стоимость, но инструмент не отдал состав — «пусто» здесь было бы неправдой.
    lines.push('Состав портфеля недоступен: брокер не вернул список позиций.');
  } else if (portfolio.positions.length === 0) {
    lines.push('Портфель пуст: позиций нет.');
  } else {
    lines.push('Портфель:');
    for (const position of portfolio.positions) {
      lines.push(`• ${formatPosition(position)}`);
    }
  }

  lines.push(`Итого: ${formatMoney(portfolio.totalValue)}`);

  if (portfolio.expectedYield) {
    lines.push(`Доходность: ${formatMoney(portfolio.expectedYield)}`);
  }

  lines.push(`Источник: ${DATA_SOURCE}, данные на ${formatDataAsOf(options.dataAsOf, options.now)}`);
  lines.push(DISCLAIMER);

  return lines.join('\n');
};

export interface AccountPortfolio {
  accountId: string;
  /** Название счёта из `invest_list_accounts`. */
  title?: string;
  portfolio: Portfolio;
}

export interface AllAccountsReportOptions extends ReportOptions {
  /** Счета, данные по которым получить не удалось: id → причина. */
  failures?: { accountId: string; title?: string; reason: string }[];
}

/**
 * Сводка по всем счетам: по каждому — состав и итог, затем общий итог.
 * Итог считается только по тем счетам, где брокер вернул стоимость.
 */
export const formatAllAccountsReport = (
  accounts: AccountPortfolio[],
  options: AllAccountsReportOptions,
): string => {
  const lines: string[] = ['Портфель по счетам брокера:'];

  // Пустые счета — одной строкой: иначе отчёт на 12 счетов раздувается
  // и модель теряет данные, которые ей нужно пересказать.
  const empty: string[] = [];
  const detailed = accounts.filter((account) => {
    const isEmpty =
      account.portfolio.positions.length === 0 && account.portfolio.positionsUnavailable !== true;
    if (isEmpty) {
      empty.push(account.title ? `${account.title} (${account.accountId})` : account.accountId);
    }
    return !isEmpty;
  });

  for (const account of detailed) {
    const label = account.title ? `${account.title} (${account.accountId})` : account.accountId;
    lines.push('');
    lines.push(`▸ ${label}`);

    const { portfolio } = account;
    if (portfolio.positionsUnavailable) {
      lines.push('  состав недоступен: брокер не вернул список позиций');
    } else if (portfolio.positions.length === 0) {
      lines.push('  позиций нет');
    } else {
      const quantityOnly = portfolio.positions.every(isQuantityOnly);
      for (const position of portfolio.positions) {
        lines.push(`  • ${formatPortfolioPosition(position)}`);
      }
      if (quantityOnly) {
        lines.push('  цены и стоимость позиций недоступны в ответе брокера');
      } else {
        const known = portfolio.positions
          .map((position) => position.positionValue)
          .filter((money): money is NonNullable<typeof money> => money !== undefined);
        if (known.length > 0) {
          const currency = known[0].currency;
          const sum = known.reduce((total, money) => total + money.amount, 0);
          lines.push(
            `  стоимость позиций по текущим ценам: ${formatNumber(sum)} ${currency}` +
              (known.length < portfolio.positions.length ? ' (часть цен недоступна)' : ''),
          );
          // Расхождение с итогом брокера — сигнал, что часть данных не сошлась;
          // авторитетным остаётся итог брокера.
          const brokerTotal = portfolio.totalValue;
          if (brokerTotal && sum > 0 && Math.abs(sum - brokerTotal.amount) / sum > 0.05) {
            lines.push('  внимание: сумма по ценам расходится с итогом брокера, ориентируйтесь на итог');
          }
        }
      }
    }

    lines.push(`  итого: ${formatMoney(portfolio.totalValue)}`);
    if (portfolio.expectedYield) {
      lines.push(`  доходность: ${formatMoney(portfolio.expectedYield)}`);
    }
  }

  if (empty.length > 0) {
    lines.push('');
    lines.push(`Позиций нет: ${empty.join(', ')}`);
  }

  if (options.failures && options.failures.length > 0) {
    lines.push('');
    lines.push('Не удалось получить данные:');
    for (const failure of options.failures) {
      const label = failure.title ? `${failure.title} (${failure.accountId})` : failure.accountId;
      lines.push(`  • ${label}: ${failure.reason}`);
    }
  }

  const withTotal = accounts.filter((account) => account.portfolio.totalValue !== undefined);
  const totalCurrency = withTotal[0]?.portfolio.totalValue?.currency ?? 'RUB';
  const mixedCurrency = withTotal.some(
    (account) => account.portfolio.totalValue?.currency !== totalCurrency,
  );
  const total = withTotal.reduce((sum, account) => sum + (account.portfolio.totalValue?.amount ?? 0), 0);

  lines.push('');
  lines.push(
    withTotal.length === 0
      ? `Итого по всем счетам: ${UNAVAILABLE}`
      : `Итого по всем счетам: ${formatNumber(total)} ${totalCurrency}` +
          (mixedCurrency ? ' (валюты счетов различаются, суммы сложены без пересчёта)' : ''),
  );
  lines.push(`Источник: ${DATA_SOURCE}, данные на ${formatDataAsOf(options.dataAsOf, options.now)}`);
  lines.push(DISCLAIMER);

  return lines.join('\n');
};

export {
  DATA_SOURCE,
  DISCLAIMER,
  UNAVAILABLE,
  formatDataAsOf,
  formatMoney,
  formatNumber,
} from './format.js';
export { formatPortfolioPosition, formatPosition } from './position-format.js';
