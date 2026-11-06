import type { DynamicStructuredTool } from '@langchain/core/tools';
import {
  formatAllAccountsReport,
  type AccountPortfolio,
} from '../../report/portfolio-report.js';
import { mapMarketValues, priceOf } from '../../parsing/mappers/market-values.mapper.js';
import type { Money } from '../../parsing/mappers/money.js';
import { mapPortfolio } from '../../parsing/mappers/portfolio.mapper.js';
import { mapPositions } from '../../parsing/mappers/positions.mapper.js';
import { withTimeout } from '../../mcp/mcp-tool.adapter.js';

/** Как называть инструмент в allowlist, правилах подтверждений и логах. */

/** Ответ с сервера в виде JSON: текст, иначе объект. */
export const asJson = (raw: unknown): unknown => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'object' && raw[0] !== null) {
    // Адаптер MCP может вернуть контент-блоки одной строкой.
    const [first] = raw as { text?: string }[];
    if (typeof first?.text === 'string') {
      return asJson(first.text);
    }
  }
  return raw;
};

export interface AccountRef {
  accountId: string;
  title?: string;
}

/** Типы счетов, по которым есть портфель (карты и накопительные счета — не портфель). */
const BROKER_ACCOUNT_TYPES = new Set([
  'ACCOUNT_TYPE_TINKOFF',
  'ACCOUNT_TYPE_TINKOFF_IIS',
  'ACCOUNT_TYPE_INVEST_BOX',
  'ACCOUNT_TYPE_DFA',
]);

/** Открытые брокерские счета из `invest_list_accounts` (в порядке ответа брокера). */
export const openAccounts = (raw: unknown): AccountRef[] => {
  const root = asJson(raw) as { accounts?: unknown } | undefined;
  const accounts = Array.isArray(root?.accounts) ? root.accounts : [];
  return accounts
    .map((item) => item as { id?: string; name?: string; status?: string; type?: string })
    .filter((item) => item.id && (item.status ?? 'ACCOUNT_STATUS_OPEN') === 'ACCOUNT_STATUS_OPEN')
    // Брокер отдаёт в общем списке ещё карты и накопительные счета: у них нет портфеля.
    .filter((item) => !item.type || BROKER_ACCOUNT_TYPES.has(item.type))
    .map((item) => ({ accountId: item.id as string, title: item.name }));
};

export interface SnapshotDeps {
  /** Инструменты реестра: имена вида `tinkoff__invest_get_portfolio`. */
  tool: (name: string) => DynamicStructuredTool | undefined;
  timeoutMs: number;
  concurrency?: number;
}

/**
 * Инструмент по короткому имени MCP: реестр хранит их с префиксом сервера
 * (`<server>__<tool>`), а в коде удобнее оперировать короткими.
 */
const toolByName = (
  tool: SnapshotDeps['tool'],
  name: string,
): DynamicStructuredTool | undefined =>
  tool(name) ?? tool(`tinkoff__${name}`);

const ACCOUNT_FAILURE = 'данные счёта недоступны';

/**
 * Снимок по всем открытым счетам: для каждого — итоги (`get_portfolio`)
 * и состав (`get_positions`, в текущем API только он возвращает бумаги).
 *
 * Идёт по счетам параллельно небольшими пачками, чтобы не упереться в лимиты
 * брокера; недоступный счёт попадает в `failures`, а не обрывает сводку.
 * Возвращает готовый текст отчёта — модель его пересказывает, не пересчитывая.
 */
export const collectAllAccounts = async (deps: SnapshotDeps): Promise<string> => {
  const accountsTool = toolByName(deps.tool, 'invest_list_accounts');
  const portfolioTool = toolByName(deps.tool, 'invest_get_portfolio');
  const positionsTool = toolByName(deps.tool, 'invest_get_positions');
  if (!portfolioTool) {
    throw new Error('инструмент портфеля недоступен');
  }

  const accounts = accountsTool
    ? openAccounts(await withTimeout(accountsTool.invoke({} as never), deps.timeoutMs, () => new Error(ACCOUNT_FAILURE)))
    : [];

  if (accounts.length === 0) {
    return formatAllAccountsReport([], {
      dataAsOf: new Date().toISOString(),
      failures: [{ accountId: '-', reason: 'брокер не вернул ни одного открытого счёта' }],
    });
  }

  const results: AccountPortfolio[] = [];
  const failures: { accountId: string; title?: string; reason: string }[] = [];
  const limit = Math.max(1, deps.concurrency ?? 3);
  const marketTool = toolByName(deps.tool, 'invest_get_market_values');

  const loadAccount = async (account: AccountRef): Promise<void> => {
    try {
      const portfolioRaw = await withTimeout(
        portfolioTool.invoke({ accountId: account.accountId } as never),
        deps.timeoutMs,
        () => new Error('таймаут'),
      );
      const portfolio = mapPortfolio({ accountId: account.accountId, ...(asJson(portfolioRaw) as object) });

      // Состав берём отдельным инструментом: `get_portfolio` отдаёт только итоги.
      if (positionsTool && portfolio.positions.length === 0) {
        try {
          const positionsRaw = await withTimeout(
            positionsTool.invoke({ accountId: account.accountId } as never),
            deps.timeoutMs,
            () => new Error('таймаут'),
          );
          const mapped = mapPositions(positionsRaw, portfolio.currency.toLowerCase());
          if (mapped.length > 0) {
            // Состав пришёл: флаг «недоступно» больше не актуален.
            portfolio.positions = mapped;
            portfolio.positionsUnavailable = false;
          }
        } catch (error) {
          // Состав необязателен: итоги уже есть. Причину видно в отладке.
          if (process.env.AGENT_DEBUG_ERRORS === '1') {
            console.warn(
              `snapshot: позиции ${account.accountId} не получены: ${(error as Error)?.message}`,
            );
          }
        }
      }

      results.push({ accountId: account.accountId, title: account.title, portfolio });
    } catch (error) {
      failures.push({
        accountId: account.accountId,
        title: account.title,
        reason: (error as Error)?.message ?? 'ошибка',
      });
    }
  };

  for (let index = 0; index < accounts.length; index += limit) {
    await Promise.all(accounts.slice(index, index + limit).map(loadAccount));
  }

  await fillPrices(marketTool, results, deps.timeoutMs);

  return formatAllAccountsReport(results, {
    dataAsOf: new Date().toISOString(),
    failures,
  });
};

/** Сколько бумаг запрашивать за один вызов цен. */
const PRICE_CHUNK = 50;

/**
 * Цены и стоимость позиций: `invest_get_positions` их не отдаёт, поэтому
 * последние цены берутся пакетно из `invest_get_market_values`. Не удалось
 * получить цену — позиция остаётся без стоимости и в отчёте помечается
 * «недоступно» (ноль не подставляется).
 */
const fillPrices = async (
  marketTool: DynamicStructuredTool | undefined,
  accounts: AccountPortfolio[],
  timeoutMs: number,
): Promise<void> => {
  if (!marketTool) {
    return;
  }

  const positions = accounts.flatMap((account) => account.portfolio.positions);
  const ids = [
    ...new Set(
      positions
        .map((position) =>
          position.instrument.classCode
            ? `${position.instrument.ticker}_${position.instrument.classCode}`
            : position.instrument.ticker,
        )
        .filter((id) => id.length > 0),
    ),
  ];
  if (ids.length === 0) {
    return;
  }

  const prices = new Map<string, Money>();
  for (let index = 0; index < ids.length; index += PRICE_CHUNK) {
    const chunk = ids.slice(index, index + PRICE_CHUNK);
    try {
      const raw = await withTimeout(
        marketTool.invoke({ instrumentId: chunk } as never),
        timeoutMs,
        () => new Error('таймаут'),
      );
      for (const [key, value] of mapMarketValues(asJson(raw))) {
        prices.set(key, value);
      }
    } catch (error) {
      if (process.env.AGENT_DEBUG_ERRORS === '1') {
        console.warn(`snapshot: цены не получены: ${(error as Error)?.message}`);
      }
    }
  }

  for (const position of positions) {
    const price = priceOf(prices, position.instrument.ticker, position.instrument.classCode);
    // Нулевая цена — это «торгов не было», а не «позиция ничего не стоит».
    if (!price || price.amount <= 0) {
      continue;
    }
    position.currentPrice = price;
    position.positionValue = {
      amount: Math.round(price.amount * position.quantity.amount * 100) / 100,
      currency: price.currency,
      raw: String(price.amount),
      isPoints: price.isPoints,
    };
  }
};
