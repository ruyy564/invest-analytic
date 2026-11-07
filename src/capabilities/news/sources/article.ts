import { stripMarkup } from '../../../shared/parsing/feed.js';

/** Минимальная длина абзаца: короткие строки — это подписи, меню и кнопки. */
const MIN_PARAGRAPH = 60;

/** Служебные блоки страницы: они есть в каждом шаблоне и текстом статьи не являются. */
const BOILERPLATE =
  /логин|пароль|зарегистр|подписаться|войти|корзин|мы делаем деньги|реклам|cookie|конфиденциальн|читайте также|поделиться|наверх|все права защищены|18\+|нашли ошибку/i;

/** Абзац похож на текст статьи: длина и хотя бы одно законченное предложение. */
const looksLikeProse = (text: string): boolean =>
  text.length >= MIN_PARAGRAPH && /[.!?…]["»)]?\s|["«(]?[^.!?…]{20,}[.!?…]$/.test(text);

/**
 * Основной текст статьи из HTML.
 *
 * Скрипты, стили и комментарии вырезаются; приоритет — `<article>`, затем `<main>`,
 * затем вся страница. Из абзацев остаются только те, что похожи на текст статьи:
 * меню, кнопки и «читайте также» — короткие строки без законченных предложений.
 */
export const extractArticleText = (html: string): string => {
  const clean = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  const body =
    /<article[^>]*>([\s\S]*?)<\/article>/i.exec(clean)?.[1] ??
    /<main[^>]*>([\s\S]*?)<\/main>/i.exec(clean)?.[1] ??
    clean;
  const paragraphs = [...body.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((match) => stripMarkup(match[1]))
    .filter((text) => text.length >= MIN_PARAGRAPH && !BOILERPLATE.test(text))
    .filter(looksLikeProse);
  const text = paragraphs.length > 0 ? paragraphs.join(' ') : stripMarkup(body);
  return text.replace(/\s+/g, ' ').trim();
};

/** Обрезка по границе слова: обрывок слова модели только мешает. */
export const clipToWords = (text: string, limit: number): string => {
  if (text.length <= limit) {
    return text;
  }
  const cut = text.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`;
};

export interface ArticleReaderOptions {
  fetchText: (url: string) => Promise<string>;
  /** Сколько символов текста оставлять по умолчанию. */
  maxChars?: number;
}

/**
 * Чтение статьи по ссылке: сеть, разбор и обрезка.
 *
 * Ошибка одного адреса не ломает выдачу — публикация просто останется без текста.
 * Слишком короткий результат (страница-заглушка, paywall) не отдаётся: заголовок
 * уже есть, а «прочитайте на сайте» модели ничего не даёт.
 */
export const createArticleReader =
  (options: ArticleReaderOptions) =>
  async (url: string | undefined, maxChars?: number): Promise<string | undefined> => {
    if (!url || !/^https?:/i.test(url)) {
      return undefined;
    }
    try {
      const html = await options.fetchText(url);
      const text = extractArticleText(html);
      const limit = maxChars ?? options.maxChars ?? 1_200;
      return text.length >= 200 ? clipToWords(text, limit) : undefined;
    } catch {
      return undefined;
    }
  };
