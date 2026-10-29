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
];
