import type { ApprovalRule } from './approval-rules.schema.js';

/**
 * Встроенные правила подтверждений — единственное место перечня
 * подтверждаемых действий. Меняется без правок графа и роутеров.
 */
export const APPROVAL_RULES: ApprovalRule[] = [
  {
    // Служебное чтение: нужно, чтобы показать счёт в запросе подтверждения.
    tool: 'tinkoff__invest_list_accounts',
    label: 'Список брокерских счетов',
    question: 'Прочитать список ваших счетов у брокера?',
    requiresApproval: false,
  },
  {
    // Тематические имена локальных инструментов (см. спецификацию data-sources).
    tool: 'portfolio__snapshot',
    label: 'Портфель по всем счетам',
    question: 'Прочитать данные портфеля по всем вашим счетам у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'portfolio__review',
    label: 'Разбор портфеля',
    question: 'Прочитать данные для разбора портфеля: счета, бумаги, цены, аналитику и новости?',
    requiresApproval: true,
  },
  {
    tool: 'market__price_dynamics',
    label: 'Динамика цены бумаги',
    // Публичные котировки: бумаги и суммы пользователя инструмент не читает.
    question: 'Прочитать историю цен бумаги за период у брокера?',
    requiresApproval: false,
  },
  {
    tool: 'market__news_digest',
    label: 'Новости по портфелю',
    question: 'Прочитать новости по бумагам портфеля и общую ленту?',
    requiresApproval: true,
  },
  {
    tool: 'news__search',
    label: 'Новости по бумаге или рынку',
    // Публичный источник: подтверждение не требуется, данные пользователя не читаются.
    question: 'Прочитать публичные новости?',
    requiresApproval: false,
  },
  {
    tool: 'instruments__*',
    label: 'Данные бумаг',
    // Фасады бумаг читают данные брокера: подтверждение обязательно.
    question: 'Прочитать данные бумаг у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'market__tax_watch',
    label: 'Налоговые события',
    question: 'Прочитать историю операций и налоговые публикации?',
    requiresApproval: true,
  },
  {
    tool: 'macro__key_rate',
    label: 'Ключевая ставка ЦБ',
    question: 'Запросить ключевую ставку и историю решений ЦБ?',
    requiresApproval: true,
  },
  {
    tool: 'market__factors',
    label: 'Рыночные факторы (нефть, курс, ставка)',
    // Публичные рыночные значения: бумаги и суммы пользователя не читаются.
    question: 'Прочитать рыночные факторы: нефть, курсы валют и ключевую ставку?',
    requiresApproval: false,
  },
  {
    tool: 'macro__cb_meetings',
    label: 'Календарь заседаний ЦБ',
    // План регулятора из файла-данных: ни бумаг, ни сумм пользователя.
    question: 'Прочитать план заседаний ЦБ по ключевой ставке?',
    requiresApproval: false,
  },
  {
    tool: 'tinkoff__invest_get_portfolio',
    label: 'Состав и стоимость портфеля',
    question: 'Прочитать данные портфеля у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_positions',
    label: 'Позиции портфеля',
    question: 'Прочитать позиции портфеля у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_market_values',
    label: 'Текущие цены бумаг',
    question: 'Прочитать текущие цены бумаг у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_candles',
    label: 'История цен бумаги',
    question: 'Прочитать историю цен бумаги у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_tech_analysis',
    label: 'Технические индикаторы',
    question: 'Прочитать технические индикаторы бумаги у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_last_trades',
    label: 'Последние сделки по бумаге',
    question: 'Прочитать последние сделки по бумаге у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_share_dividends',
    label: 'Дивиденды по бумаге',
    question: 'Прочитать данные о дивидендах у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_asset_fundamentals',
    label: 'Фундаментальные показатели',
    question: 'Прочитать фундаментальные показатели бумаги у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_news',
    label: 'Новости по бумаге',
    question: 'Прочитать новости по бумаге у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_instrument_reports',
    label: 'Календарь отчётности эмитента',
    question: 'Прочитать даты публикации отчётности эмитента у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_get_operations',
    label: 'История операций по счёту',
    question: 'Прочитать историю операций по счёту у брокера?',
    requiresApproval: true,
  },
  {
    tool: 'tinkoff__invest_find_instrument',
    label: 'Поиск бумаги по тикеру',
    question: 'Найти бумагу по тикеру у брокера?',
    requiresApproval: true,
  },
];
