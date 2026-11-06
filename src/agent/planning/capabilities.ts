import type { PlanGroup } from '../../collection/plan.js';

/**
 * Возможность, которую модель может выбрать: доменный фасад, а не низкоуровневый
 * вызов брокера. Описание — «когда звать», а не «что делает».
 */
export interface Capability {
  tool: string;
  description: string;
  group: PlanGroup;
  /** Аргументы по умолчанию: модель может их не указывать. */
  args?: Record<string, unknown>;
}

/** Каталог возможностей: то, из чего планировщик собирает шаги. */
export const CAPABILITIES: readonly Capability[] = [
  {
    tool: 'portfolio__snapshot',
    description: 'Состав, стоимость и доходность портфеля по счетам. Вызывай для «что у меня», «сколько стоит», разбора портфеля.',
    group: 'portfolio',
  },
  {
    tool: 'instruments__find',
    description: 'Найти бумагу по тикеру или названию и узнать класс торгов. Нужен первым, если бумага названа словами.',
    group: 'reference',
  },
  {
    tool: 'instruments__prices',
    description: 'Текущая цена бумаги и изменение за день. Для «сколько стоит» и точечных вопросов по цене.',
    group: 'prices',
  },
  {
    tool: 'instruments__candles',
    description: 'История цен за период: график и динамика 1/7/30/180 дней. Для «почему упал», «что с ценой».',
    group: 'candles',
  },
  {
    tool: 'instruments__forecast',
    description: 'Прогноз аналитиков: цель, потенциал, мнение. Для вопросов «стоит ли», «перспективы».',
    group: 'analytics',
  },
  {
    tool: 'instruments__dividends',
    description: 'Дивиденды: размер, доходность, даты отсечки и выплаты, регулярность.',
    group: 'dividends',
  },
  {
    tool: 'instruments__meta',
    description: 'Справочник бумаги: сектор, параметры облигации (купон, НКД), фундаментальные показатели.',
    group: 'reference',
  },
  {
    tool: 'news__search',
    description: 'Новости по бумаге или общая инвестиционная повестка за период.',
    group: 'news',
  },
];

/** Каталог по имени инструмента: используется валидацией плана. */
export const capabilityByName = (
  capabilities: readonly Capability[] = CAPABILITIES,
): Map<string, Capability> => new Map(capabilities.map((item) => [item.tool, item]));
