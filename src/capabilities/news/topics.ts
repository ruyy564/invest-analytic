/**
 * Тема новостей: «новости по криптовалютам», «что по нефти» и подобное.
 *
 * Общая повестка на такой вопрос отвечает мусором (спорт, криминал), поэтому тема
 * определяется детерминированно по словарю и передаётся в сбор как фильтр.
 * Это данные: новый тематический раздел добавляется строкой в список.
 */
export interface NewsTopic {
  id: string;
  /** Подпись для ответа: «Новости: криптовалюты». */
  title: string;
  /** Подстроки (кириллица) и слова (латиница) для отбора публикаций. */
  matchers: string[];
}

export const NEWS_TOPICS: readonly NewsTopic[] = [
  {
    id: 'crypto',
    title: 'криптовалюты',
    matchers: [
      'крипт',
      'биткоин',
      'биткойн',
      'bitcoin',
      'btc',
      'эфириум',
      'ethereum',
      'eth',
      'usdt',
      'tether',
      'стейблкоин',
      'блокчейн',
      'токен',
      'defi',
      'нфт',
      'nft',
      'цифровых актив',
      'цифровые актив',
      'цфа',
    ],
  },
  {
    id: 'oil',
    title: 'нефть и газ',
    matchers: ['нефт', 'brent', 'urals', 'опек', 'газ', 'демпфер', 'ндпи', 'бензин', 'дизел'],
  },
  {
    id: 'metals',
    title: 'металлы и золото',
    matchers: ['золот', 'металл', 'алюмини', 'никел', 'медь', 'медн', 'сталь', 'платин', 'паллади'],
  },
  {
    id: 'rate',
    title: 'ключевая ставка и инфляция',
    matchers: ['ключевая ставка', 'ставк', 'инфляц', 'центробанк', 'цб рф'],
  },
  {
    id: 'sanctions',
    title: 'санкции и регулирование',
    matchers: ['санкц', 'ограничени', 'регулятор', 'sdn', 'лицензи', 'запрет'],
  },
  {
    id: 'currency',
    title: 'валютный рынок',
    matchers: ['доллар', 'рубл', 'юан', 'валютн'],
  },
];

/** Латиница ищется словом: иначе «eth» находится внутри «method». */
const LATIN = /^[a-z0-9]+$/i;

const matchesWord = (haystack: string, matcher: string): boolean => {
  if (!LATIN.test(matcher)) {
    return haystack.includes(matcher);
  }
  return new RegExp(`(?<![a-z0-9])${matcher}(?![a-z0-9])`, 'i').test(haystack);
};

/** Тема вопроса: `undefined` — это общая повестка. */
export const topicOf = (question: string): NewsTopic | undefined => {
  const normalized = question.toLowerCase().replace(/ё/g, 'е');
  return NEWS_TOPICS.find((topic) =>
    topic.matchers.some((matcher) => matchesWord(normalized, matcher)),
  );
};

/** Публикация относится к теме: совпадение по заголовку или аннотации. */
export const matchesMatchers = (
  item: { title: string; summary?: string },
  matchers: readonly string[],
): boolean => {
  const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase().replace(/ё/g, 'е');
  return matchers.some((matcher) => matchesWord(haystack, matcher));
};

/** Публикация относится к теме вопроса. */
export const matchesTopic = (
  item: { title: string; summary?: string },
  topic: NewsTopic,
): boolean => matchesMatchers(item, topic.matchers);
