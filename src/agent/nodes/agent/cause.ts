import type { AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages';

/**
 * Ответ на «почему упал/вырос X».
 *
 * Данные брокера причин не содержат: есть цены и объёмы. Объяснение берётся только
 * из публикаций, поэтому ответ без ссылки на найденную новость — домысел. Здесь
 * собирается доказательная база прогона и проверяется, что ответ на неё опирается;
 * если опоры нет, отдаются факты и честное «причина не установлена».
 */

/** Новостные инструменты: их ответ — публикации с датой и источником. */
export const NEWS_TOOLS: ReadonlySet<string> = new Set([
  'news__search',
  'invest_get_news',
  'tinkoff__invest_get_news',
  'market__news_digest',
]);

/** Фасад новостей: публичный источник, подтверждение не требуется. */
export const NEWS_SEARCH_TOOL = 'news__search';

export interface NewsItem {
  /** Дата публикации, `YYYY-MM-DD`. */
  date: string;
  source: string;
  title: string;
}

/** Признак того, что причину назвать нельзя: именно этой фразой отвечает и код. */
export const CAUSE_UNKNOWN = 'Причина не установлена';

const UNKNOWN_PATTERN = /причина\s+не\s+установлена/i;

/** Отговорка «нет доступа к новостям» — не ответ: причины ищут в лентах. */
const REFUSAL_PATTERN =
  /нет доступа|не имею доступа|не могу получить доступ|доступ к (?:новостям|данным)/i;

const typeOf = (message: BaseMessage): string =>
  (message as unknown as { _getType?: () => string })._getType?.() ?? '';

/** Имена инструментов по идентификаторам вызовов: результат опознаётся по контракту. */
const callNames = (messages: BaseMessage[]): Map<string, string> => {
  const names = new Map<string, string>();
  for (const message of messages) {
    if (typeOf(message) !== 'ai') {
      continue;
    }
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (call.id) {
        names.set(call.id, call.name);
      }
    }
  }
  return names;
};

/** Тексты ответов перечисленных инструментов в порядке появления. */
export const toolResults = (
  messages: BaseMessage[],
  names: ReadonlySet<string>,
): string[] => {
  const called = callNames(messages);
  const results: string[] = [];
  for (const message of messages) {
    const kind = (message as ToolMessage).additional_kwargs?.kind;
    if (typeOf(message) !== 'tool' || typeof message.content !== 'string') {
      continue;
    }
    const name = called.get((message as ToolMessage).tool_call_id ?? '');
    if (!name || !names.has(name) || kind === 'denied' || kind === 'interrupted') {
      continue;
    }
    if (message.content.trim().length > 0) {
      results.push(message.content);
    }
  }
  return results;
};

/** Строка ленты: «• 2026-11-05 [interfax] Заголовок». */
const FEED_LINE = /^[•*-]\s*(\d{4}-\d{2}-\d{2})\s*\[([^\]]+)\]\s*(.+)$/;

/** Публикации из JSON-ответа брокера: `items` с `title`, `ts`, `source`. */
const jsonNews = (text: string): NewsItem[] => {
  if (!text.trimStart().startsWith('{')) {
    return [];
  }
  try {
    const root = JSON.parse(text) as { items?: unknown };
    const list = Array.isArray(root.items) ? root.items : [];
    return list.flatMap((raw) => {
      const item = raw as Record<string, unknown>;
      const title = typeof item.title === 'string' ? item.title.trim() : '';
      const ts = typeof item.ts === 'string' ? item.ts : '';
      if (title.length === 0 || ts.length < 10) {
        return [];
      }
      const source = typeof item.source === 'string' ? item.source : 'брокер';
      return [{ date: ts.slice(0, 10), source, title }];
    });
  } catch {
    return [];
  }
};

/** Публикации из результатов новостных инструментов текущего прогона. */
export const newsItems = (messages: BaseMessage[]): NewsItem[] => {
  const items: NewsItem[] = [];
  for (const text of toolResults(messages, NEWS_TOOLS)) {
    for (const line of text.split(/\r?\n/)) {
      const match = FEED_LINE.exec(line.trim());
      if (match) {
        items.push({ date: match[1], source: match[2].trim(), title: match[3].trim() });
      }
    }
    items.push(...jsonNews(text));
  }
  return items.filter(
    (item, index) => items.findIndex((other) => other.title === item.title) === index,
  );
};

/**
 * Причины недоступности источников из ответов новостных инструментов.
 * Показываем их в ответе: иначе «причин нет» выглядит как отговорка, а не как
 * результат сбора.
 */
export const newsFailures = (messages: BaseMessage[]): string[] => {
  const failures: string[] = [];
  for (const text of toolResults(messages, NEWS_TOOLS)) {
    for (const line of text.split(/\r?\n/)) {
      const match = /^Недоступные источники:\s*(.+)$/.exec(line.trim());
      if (match) {
        failures.push(match[1].trim());
      }
    }
  }
  return [...new Set(failures)];
};

/** Тикеры, по которым новости уже запрошены в прогоне (`''` — общая повестка). */
export const newsTickersRequested = (messages: BaseMessage[]): Set<string> => {
  const asked = new Set<string>();
  for (const message of messages) {
    if (typeOf(message) !== 'ai') {
      continue;
    }
    for (const call of (message as AIMessage).tool_calls ?? []) {
      if (call.name !== NEWS_SEARCH_TOOL) {
        continue;
      }
      const ticker = (call.args as { ticker?: unknown } | undefined)?.ticker;
      asked.add(typeof ticker === 'string' ? ticker.trim().toUpperCase() : '');
    }
  }
  return asked;
};

/** Значимые слова заголовка: по ним видно, что ответ ссылается на публикацию. */
const keywordsOf = (title: string): string[] =>
  title
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= 5);

/** Сокращения, которые законно встречаются в ответе и без данных прогона. */
const NEUTRAL_TOKENS = new Set([
  'RUB',
  'USD',
  'EUR',
  'CNY',
  'ETF',
  'IPO',
  'SPO',
  'GDP',
  'CPI',
  'PMI',
  'IFRS',
  'OIBDA',
]);

/**
 * Тикеры, которые есть в данных прогона и в справочнике алиасов.
 * Всё остальное в ответе — подстановка «из знаний» модели.
 */
export const knownTickers = (
  messages: BaseMessage[],
  aliases: Record<string, readonly string[]> = {},
): Set<string> => {
  const known = new Set(Object.keys(aliases));
  for (const values of Object.values(aliases)) {
    for (const value of values) {
      if (/^[A-Z][A-Z0-9]{1,4}$/.test(value.trim())) {
        known.add(value.trim().toUpperCase());
      }
    }
  }
  for (const message of messages) {
    if (typeOf(message) !== 'tool' || typeof message.content !== 'string') {
      continue;
    }
    for (const token of message.content.match(/\b[A-Z][A-Z0-9]{1,4}\b/g) ?? []) {
      known.add(token);
    }
  }
  return known;
};

/** Тикеры в ответе, которых нет в данных: модель назвала бумагу, которой не видела. */
export const foreignTickers = (answer: string, known: ReadonlySet<string>): string[] => {
  const found = answer.match(/\b[A-Z][A-Z0-9]{1,4}\b/g) ?? [];
  return [...new Set(found)].filter((token) => !known.has(token) && !NEUTRAL_TOKENS.has(token));
};

/** Дата публикации в ответе — тоже ссылка на источник: и `2026-11-06`, и `06.11`. */
const mentionsDate = (answer: string, item: NewsItem): boolean => {
  const [year, month, day] = item.date.split('-');
  return (
    answer.includes(item.date) ||
    (year !== undefined && answer.includes(`${day}.${month}.${year}`)) ||
    answer.includes(`${day}.${month}`)
  );
};

/**
 * Ответ на «почему» опирается на найденные публикации или прямо признаёт, что
 * причина не установлена. Ответ с чужим тикером опорой не считается: он про
 * другую бумагу, даже если похож на правду.
 *
 * Ссылка обязательна: пересказ публикации без даты и источника проверить нельзя,
 * поэтому он считается домыслом, даже если слова совпали с заголовком.
 */
export const isGroundedCauseAnswer = (
  answer: string,
  news: NewsItem[],
  known: ReadonlySet<string>,
): boolean => {
  if (REFUSAL_PATTERN.test(answer)) {
    return false;
  }
  if (foreignTickers(answer, known).length > 0) {
    return false;
  }
  if (UNKNOWN_PATTERN.test(answer)) {
    return true;
  }
  const cites = news.some(
    (item) => mentionsDate(answer, item) || answer.includes(`[${item.source}]`),
  );
  if (!cites) {
    return false;
  }
  const lower = answer.toLowerCase();
  return news.some(
    (item) =>
      mentionsDate(answer, item) ||
      keywordsOf(item.title).some((word) => lower.includes(word)),
  );
};

/** Заголовок для цитаты: полный текст статьи не нужен, ссылка должна читаться. */
const HEADLINE_LIMIT = 160;
const headlineOf = (title: string): string => {
  const single = title.replace(/\s+/g, ' ').trim();
  return single.length > HEADLINE_LIMIT ? `${single.slice(0, HEADLINE_LIMIT).trimEnd()}…` : single;
};

/** Факты прогона для ответа о причине: динамика, рыночные факторы, публикации. */
export interface CauseFactsInput {
  dynamics: string[];
  news: NewsItem[];
  tickers: string[];
  /** Готовый блок рыночных факторов числами (нефть, курс, ставка). */
  macro?: string[];
  /** Источники, которые не удалось прочитать: их видно в ответе, а не в логах. */
  failures?: string[];
}

/** Вступление, когда причина не установлена: именно этой фразой отвечает и код. */
export const NO_CAUSE_INTRO = `${CAUSE_UNKNOWN}: в данных брокера причин движения цены нет, а в доступных публикациях объяснения не нашлось.`;

/** Вступление, когда вопрос требовал трактовки, а модель промолчала. */
export const NO_INTERPRETATION_INTRO =
  'Оценку не даю: модель не ответила, а трактовать факты за неё — значит выдумывать.';

/** Факты прогона: движения цен, рыночные факторы, публикации и недоступные источники. */
const factsLines = (options: CauseFactsInput): string[] => {
  const { dynamics, news, tickers, macro = [], failures = [] } = options;
  const lines: string[] = [];

  if (dynamics.length > 0) {
    lines.push('', 'Что известно по данным:');
    for (const text of dynamics) {
      lines.push(text.trim());
    }
  }

  if (macro.length > 0) {
    lines.push('', 'Рыночные факторы:');
    for (const text of macro) {
      lines.push(text.trim());
    }
  }

  if (news.length > 0) {
    lines.push('', 'Публикации, которые могут объяснять движение (оценка):');
    for (const item of news.slice(0, 5)) {
      lines.push(`• ${item.date} [${item.source}] ${headlineOf(item.title)}`);
    }
  } else {
    const about = tickers.length > 0 ? ` (${tickers.join(', ')})` : '';
    lines.push('', `Публикаций по теме в доступных источниках нет${about}.`);
  }

  if (failures.length > 0) {
    lines.push(`Не удалось прочитать: ${failures.join(', ')}.`);
  }

  return lines;
};

const DISCLAIMER =
  'Это информационная сводка по данным брокера, а не инвестиционная рекомендация.';

/** Ответ по фактам: честное «причина не установлена» и данные прогона. */
export const causeFactsAnswer = (options: CauseFactsInput): string =>
  [NO_CAUSE_INTRO, ...factsLines(options), '', DISCLAIMER].join('\n');

/**
 * Факты вместо трактовки: вопрос требовал оценки, а ответа модели нет.
 * Сырой отчёт инструмента здесь не годится — он не отвечает на вопрос.
 */
export const factsWithoutInterpretation = (options: CauseFactsInput): string =>
  [
    NO_INTERPRETATION_INTRO,
    'Вот что показывают данные прогона:',
    ...factsLines(options),
    '',
    DISCLAIMER,
  ].join('\n');
