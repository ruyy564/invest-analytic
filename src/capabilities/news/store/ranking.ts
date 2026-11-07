/**
 * Ранжирование публикаций под вопрос.
 *
 * Ленты отдают десятки заголовков, и порядок «по дате» ставит сверху случайные
 * сюжеты. Здесь порядок задаёт сам вопрос: слова запроса ищутся в заголовке
 * (весомее) и аннотации, редкие слова ценнее частых — это BM25-подобный счёт
 * без внешних зависимостей.
 */

/** Служебные слова вопроса: без них «почему вырос» даёт шум. */
const STOP = new Set([
  'почему',
  'зачем',
  'какой',
  'какая',
  'какие',
  'каких',
  'когда',
  'этого',
  'этот',
  'этой',
  'такой',
  'такие',
  'очень',
  'можно',
  'нужно',
  'просто',
  'вообще',
  'сильно',
  'лучше',
  'хуже',
  'есть',
  'было',
  'будет',
  'может',
  'меня',
  'меня',
  'моих',
  'мои',
]);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/** Основа слова: первые буквы — прощает падежи («нефть»/«нефти»/«нефтяной»). */
const stem = (word: string): string => word.slice(0, 5);

/** Термы запроса: значимые слова, приведённые к основе. */
export const termsOf = (text: string): string[] => [
  ...new Set(
    wordsOf(text)
      .filter((word) => word.length >= 4 && !STOP.has(word))
      .map(stem),
  ),
];

const countOf = (words: readonly string[], term: string): number =>
  words.reduce((sum, word) => (word === term ? sum + 1 : sum), 0);

/**
 * Переставляет публикации по релевантности вопросу.
 *
 * Ничего не выбрасывает: нерелевантные остаются в конце, поэтому ответ никогда
 * не остаётся без данных из-за «не тех» слов в вопросе.
 */
export const rankByQuery = <T extends { title: string; summary?: string; publishedAt: string }>(
  items: readonly T[],
  query: string,
): T[] => {
  const terms = termsOf(query);
  if (terms.length === 0 || items.length === 0) {
    return [...items];
  }

  const docs = items.map((item) => ({
    item,
    title: wordsOf(item.title).map(stem),
    summary: wordsOf(item.summary ?? '').map(stem),
  }));

  const documentFrequency = new Map<string, number>();
  for (const term of terms) {
    const frequency = docs.filter(
      (doc) => countOf(doc.title, term) + countOf(doc.summary, term) > 0,
    ).length;
    documentFrequency.set(term, frequency);
  }

  const scored = docs.map((doc) => {
    let score = 0;
    for (const term of terms) {
      const inTitle = countOf(doc.title, term);
      const inSummary = countOf(doc.summary, term);
      if (inTitle + inSummary === 0) {
        continue;
      }
      const idf = Math.log(1 + docs.length / (1 + (documentFrequency.get(term) ?? 0)));
      // Заголовок весит вдвое; насыщение — чтобы повторы не забивали выдачу.
      score += (idf * (2 * inTitle + inSummary)) / (1 + inTitle + inSummary);
    }
    return { ...doc, score };
  });

  return scored
    .sort(
      (left, right) =>
        right.score - left.score || right.item.publishedAt.localeCompare(left.item.publishedAt),
    )
    .map((doc) => doc.item);
};
