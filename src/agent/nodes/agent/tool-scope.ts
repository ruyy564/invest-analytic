/**
 * Отбор инструментов под вопрос.
 *
 * Anthropic («Writing effective tools for agents», «Code execution with MCP»):
 * десятки определений инструментов в контексте путают модель и съедают токены.
 * Поэтому агенту передаётся базовый набор плюс расширения по теме вопроса, а не
 * все 54 инструмента брокера сразу. Имена MCP приходят с префиксом сервера
 * (`tinkoff__invest_get_share`) — сравнение идёт по хвосту `invest_*`.
 */

/** Инструменты, нужные для любого вопроса: поиск бумаги, цены, новости, знания. */
const CORE: readonly string[] = [
  // Локальные фасады и тематические инструменты приложения.
  'instruments__find',
  'instruments__prices',
  'instruments__candles',
  'instruments__forecast',
  'instruments__dividends',
  'instruments__meta',
  'news__search',
  'market__factors',
  'market__price_dynamics',
  'market__news_digest',
  'macro__key_rate',
  'knowledge__explain',
  'market__tax_watch',
  'portfolio__snapshot',
  'portfolio__review',
  'security__brief',
  // MCP без префикса сервера: база по бумаге, портфелю и новостям.
  'invest_find_instrument',
  'invest_get_share',
  'invest_get_portfolio',
  'invest_get_positions',
  'invest_get_operations',
  'invest_get_news',
  'invest_get_market_values',
  'invest_get_share_dividends',
  'invest_get_asset_fundamentals',
  'invest_get_forecast',
  'invest_get_instrument_reports',
  'invest_get_insider_deals',
  'invest_get_asset',
  'invest_get_brand',
  'invest_get_candles',
  'invest_get_user_info',
  'invest_list_accounts',
];

/** Расширения: тема вопроса добавляет нужные инструменты, остальные не грузятся. */
const EXTENSIONS: readonly { pattern: RegExp; tools: readonly string[] }[] = [
  {
    pattern: /облигац|купон|оферт|погашен|нкд|флоатер/i,
    tools: ['invest_list_bonds', 'invest_get_bond', 'invest_get_bond_events', 'invest_get_bond_accrued'],
  },
  {
    pattern: /фьючерс|опцион|срочн|контракт|экспирац/i,
    tools: ['invest_list_futures', 'invest_get_future', 'invest_list_options', 'invest_get_option'],
  },
  { pattern: /фонд|etf|бпиф|пиф/i, tools: ['invest_list_etfs', 'invest_get_etf'] },
  { pattern: /цфа|цифров|dfa|смарт-?актив/i, tools: ['invest_list_dfas', 'invest_get_dfa'] },
  {
    pattern: /структурн|защит[а-яё]* капитал/i,
    tools: ['invest_list_structured_notes', 'invest_get_structured_note'],
  },
  { pattern: /валют|доллар|евро|юан|курс/i, tools: ['invest_get_currency', 'invest_list_currencies'] },
  { pattern: /индекс|индикатив/i, tools: ['invest_list_indicatives'] },
  { pattern: /сигнал|стратеги/i, tools: ['invest_list_signals', 'invest_list_strategies'] },
  {
    pattern: /консенсус|прогноз|целев[а-яё]* цен/i,
    tools: ['invest_list_consensus_forecasts', 'invest_get_forecast'],
  },
  {
    pattern: /график|свеч|техническ|уровн|тренд/i,
    tools: ['invest_get_candles', 'invest_get_last_trades', 'invest_get_tech_analysis'],
  },
  {
    pattern: /расписан|торгуется|сесси|статус/i,
    tools: ['invest_get_trading_schedule', 'invest_get_trading_statuses'],
  },
  {
    pattern: /риск|марж|плеч|обеспечен/i,
    tools: [
      'invest_get_risk_rates',
      'invest_get_broker_account_margin',
      'invest_get_broker_account_values',
      'invest_get_blocked_guarantee',
    ],
  },
  {
    pattern: /ордер|заявк|стоп-?лосс|стоп-?заявк/i,
    tools: ['invest_get_orders', 'invest_get_order_state', 'invest_get_stoporders'],
  },
  { pattern: /стакан|ликвидн|спред/i, tools: ['invest_get_orderbook'] },
  {
    pattern: /каталог|список бумаг|какие есть|все бумаги/i,
    tools: ['invest_list_shares', 'invest_list_bonds', 'invest_list_etfs', 'invest_list_assets', 'invest_list_brands'],
  },
];

/** Хвост имени MCP без префикса сервера: `tinkoff__invest_get_share` → `invest_get_share`. */
export const baseToolName = (name: string): string => {
  const at = name.indexOf('__');
  return at < 0 ? name : name.slice(at + 2);
};

/**
 * Инструменты под вопрос: базовый набор плюс расширения по теме.
 * Если отбор не дал ничего (нестандартные имена в тестах или новой интеграции),
 * возвращается исходный набор — лучше больше инструментов, чем пустой список.
 */
export const toolsForQuestion = <T extends { name: string }>(
  tools: readonly T[],
  question: string,
): T[] => {
  const allowed = new Set(CORE);
  for (const { pattern, tools: extra } of EXTENSIONS) {
    if (pattern.test(question)) {
      for (const name of extra) {
        allowed.add(name);
      }
    }
  }
  const scoped = tools.filter((tool) => allowed.has(tool.name) || allowed.has(baseToolName(tool.name)));
  return scoped.length > 0 ? scoped : [...tools];
};
