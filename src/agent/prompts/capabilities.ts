/**
 * Справка о возможностях агента: карта возможностей и сборка ответа.
 * Текст собирается кодом — модель на вопрос «что ты умеешь» отвечает своей
 * «визиткой», поэтому справку формируем сами.
 */

/** Возможность, о которой рассказываем в справке. */
export interface Capability {
  id: string;
  title: string;
  description: string;
  /** Примеры вопросов, которые пользователь может задать дословно. */
  examples: string[];
  /** Возможность доступна только при включённой ветке разбора. */
  requiresReview?: boolean;
  /** Возможность доступна только при включённой ветке новостей. */
  requiresNews?: boolean;
}

/** Карта возможностей: единственное место, где перечислено, что умеет сервис. */
export const CAPABILITIES: Capability[] = [
  {
    id: 'portfolio',
    title: 'Портфель и счета',
    description: 'позиции, количество, цена, стоимость и доходность по каждому счёту и итог по всем',
    examples: ['что у меня в портфеле?', 'сколько стоит мой портфель?'],
  },
  {
    id: 'review',
    title: 'Разбор портфеля',
    description: 'диверсификация, концентрация, пробелы, тип стратегии и что изменить',
    examples: ['проанализируй мой портфель'],
    requiresReview: true,
  },
  {
    id: 'account',
    title: 'Разбор счёта',
    description: 'то же, но по одному счёту — состав, структура, концентрация, налоги, пробелы',
    // Счёт называем по имени: номера в примерах не используем.
    examples: ['разбери счёт Портфельное инвестирование'],
    requiresReview: true,
  },
  {
    id: 'instrument',
    title: 'Разбор бумаги',
    description: 'динамика цены за 1/7/30/180 дней, прогноз аналитиков, дивиденды, новости бумаги и оценка её сектора',
    examples: ['разбери бумагу SBER', 'разбери Сбер'],
    requiresReview: true,
  },
  {
    id: 'analytics',
    title: 'Аналитика и макро',
    description: 'прогнозы аналитиков и потенциал бумаг, дивиденды, ключевая ставка ЦБ, налоговые изменения',
    examples: ['какая ключевая ставка ЦБ?', 'какие дивиденды у SBER?'],
  },
  {
    id: 'news',
    title: 'Новости рынка',
    description: 'сводка инвестиционных новостей за сегодня, неделю, месяц и полгода из всех источников',
    examples: ['какие последние новости в мире инвестиций?'],
    requiresNews: true,
  },
];

/** Вопрос про возможности агента — отвечаем детерминированно, без модели. */
export const CAPABILITIES_PATTERN =
  /(что|чего) ты (можешь|умеешь)|твои возможности|кто ты(?![а-яa-z])|что ты за|расскажи о себе|чем (ты )?(можешь )?помо(жешь|чь)|что здесь можно узнать|что ты знаешь|чем полезен|как (ты )?(можешь|умеешь) помочь/i;

/** Что сервис не делает — говорим прямо, чтобы не было ложных ожиданий. */
export const CAPABILITY_LIMITS = [
  'Границы: торговых операций не выполняю; ответы носят информационный характер',
  'и не являются индивидуальной инвестиционной рекомендацией.',
  'Погода, политика и другие посторонние темы — вне области сервиса.',
].join(' ');

/** Подсказка, с чего начать. */
export const CAPABILITY_NEXT_STEPS = [
  'Начните с «что у меня в портфеле?» или «проанализируй мой портфель».',
].join(' ');

export interface CapabilitiesOptions {
  /** Ветка разбора портфеля включена (`REVIEW_ENABLED`). */
  reviewEnabled?: boolean;
  /** Ветка новостей включена (`NEWS_FEED_ENABLED`). */
  newsEnabled?: boolean;
}

/** Какие возможности показывать при текущей конфигурации. */
export const availableCapabilities = (
  options: CapabilitiesOptions = {},
): Capability[] =>
  CAPABILITIES.filter(
    (capability) =>
      (capability.requiresReview !== true || options.reviewEnabled !== false) &&
      (capability.requiresNews !== true || options.newsEnabled !== false),
  );

/** Отключённые возможности: о них честно предупреждаем, а не обещаем. */
export const disabledCapabilitiesNote = (options: CapabilitiesOptions = {}): string | undefined => {
  const disabled: string[] = [];
  if (options.reviewEnabled === false) {
    disabled.push('разбор портфеля, счёта и бумаги');
  }
  if (options.newsEnabled === false) {
    disabled.push('сводка новостей');
  }
  return disabled.length > 0 ? `Сейчас отключено: ${disabled.join(', ')}.` : undefined;
};

/** Готовый ответ на вопрос о возможностях. */
export const buildCapabilitiesAnswer = (options: CapabilitiesOptions = {}): string => {
  const lines = ['Я — агент по вашему портфелю Tinkoff Invest. Что умею:', ''];

  for (const capability of availableCapabilities(options)) {
    lines.push(`• ${capability.title} — ${capability.description}.`);
    lines.push(`  Спросите: ${capability.examples.map((example) => `«${example}»`).join(' или ')}`);
  }

  const disabled = disabledCapabilitiesNote(options);
  if (disabled) {
    lines.push('', disabled);
  }

  lines.push('', CAPABILITY_LIMITS, CAPABILITY_NEXT_STEPS);
  return lines.join('\n');
};
