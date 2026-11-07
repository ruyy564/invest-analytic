/** Секции по бумагам: разбор и оценка используют общие факты. */
export { securitiesProvider, createSecuritiesProvider } from './detail.provider.js';
export { opinionsProvider } from './opinions.provider.js';
export { createAnalyticsProviders } from './analytics.provider.js';
export {
  noHoldingsReason,
  periodsLine,
  securitiesOf,
  type SecurityFacts,
} from './shared.js';
