import type { PlanGroup } from '../../collection/plan.js';
import type { Capability } from './capabilities.js';

/**
 * Каталог для планировщика в агентском режиме: это MCP-инструменты, которые уже
 * умеет исполнять сбор. Фасады (`instruments__prices`) остаются для свободного
 * ответа, а отчёт работает на проверенных MCP-запросах.
 */
export const MCP_CAPABILITIES: readonly Capability[] = [
  {
    tool: 'invest_list_accounts',
    description: 'Список счетов брокера: нужен первым, если счёт не назван.',
    group: 'accounts',
  },
  {
    tool: 'invest_get_portfolio',
    description: 'Состав и стоимость портфеля по счёту. Для «что у меня», «сколько стоит».',
    group: 'portfolio',
  },
  {
    tool: 'invest_get_positions',
    description: 'Позиции счёта: бумаги и количество.',
    group: 'portfolio',
  },
  {
    tool: 'invest_get_market_values',
    description: 'Текущие цены бумаг.',
    group: 'prices',
  },
  {
    tool: 'invest_get_candles',
    description: 'История цен за период: график и динамика.',
    group: 'candles',
  },
  {
    tool: 'invest_get_forecast',
    description: 'Прогноз аналитиков: цель и потенциал.',
    group: 'analytics',
  },
  {
    tool: 'invest_get_share_dividends',
    description: 'Дивиденды бумаги: размер, доходность, даты.',
    group: 'dividends',
  },
  {
    tool: 'invest_get_news',
    description: 'Новости по бумаге или рынку.',
    group: 'news',
  },
];

/** Группы, которые сбор и отчёт уже умеют использовать. */
export const KNOWN_GROUPS: readonly PlanGroup[] = MCP_CAPABILITIES.map(
  (capability) => capability.group,
);
