import { DynamicStructuredTool } from '@langchain/core/tools';
import { toZodV3 } from '../../../transports/mcp/tool-schema.js';
import { collectNewsDigest } from './news-digest/news-digest.service.js';
import type { NewsRegistry } from '../../../capabilities/news/news.registry.js';
import { loadTickerAliases } from '../news.aliases.js';
import { factorsFor, matchFactors } from '../factors.js';
import { topicOf } from '../topics.js';
import { loadCompanyProfiles, companyProfileOf } from '../../reports/index.js';
import { createArticleReader } from '../sources/article.js';
import { storedId, toStored, type NewsIndex } from '../store/news-index.js';
import { rankByQuery } from '../store/ranking.js';

/** Имя фасада новостей: один инструмент на все источники. */
export const NEWS_SEARCH_TOOL = 'news__search';

export interface NewsSearchToolOptions {
  registry: NewsRegistry;
  scanPages: number;
  maxItems: number;
  /** Файл алиасов: в лентах бумагу называют по имени («Лукойл»), а не по тикеру. */
  aliasesFile?: string;
  /** Класс торгов для брокера: `LKOH` → `LKOH_TQBR` (иначе «Instrument not found»). */
  resolveInstrumentId?: (ticker: string) => Promise<string | undefined>;
  /** Сколько символов аннотации показывать модели: заголовка для разбора мало. */
  summaryLimit?: number;
  /** Загрузчик статей: нужен для дочитывания текста по ссылке. */
  fetchText?: (url: string) => Promise<string>;
  /** Сколько статей дочитывать целиком за один запрос. */
  articleLimit?: number;
  /** Сколько символов текста статьи отдавать модели. */
  articleChars?: number;
  /** Файл профилей: по нему подбираются факторы поиска причин. */
  profilesFile?: string;
  /** Сколько публикаций по факторам показывать. */
  factorLimit?: number;
  /** Индекс собранных публикаций: история шире сетевого окна лент. */
  index?: NewsIndex;
}

/** Аннотация одной строкой: модель должна видеть содержание, а не только заголовок. */
const clip = (text: string, limit: number): string => {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= limit) {
    return clean;
  }
  const cut = clean.slice(0, limit);
  const space = cut.lastIndexOf(' ');
  return `${space > limit / 2 ? cut.slice(0, space) : cut}…`;
};

/**
 * Фасад новостей: параметры запроса вместо фиксированной сводки по четырём
 * периодам. Периоды и формат — дело представления, а не инструмента.
 */
export const createNewsSearchTool = (options: NewsSearchToolOptions): DynamicStructuredTool => {
  // Алиасы читаются при сборке инструмента: файл меняется вместе с деплоем.
  const aliases = loadTickerAliases(options.aliasesFile ?? 'data/ticker-aliases.yaml');

  return new DynamicStructuredTool({
    name: NEWS_SEARCH_TOOL,
    description:
      'Новости по бумаге или общая инвестиционная повестка. Параметры: тикер, глубина в днях, ' +
      'сколько заголовков вернуть. Источник и дата указаны у каждой новости.',
    schema: toZodV3({
      type: 'object',
      properties: {
        ticker: { type: 'string', description: 'Тикер бумаги; без него — общая повестка' },
        days: { type: 'number', description: 'Глубина выборки в днях, по умолчанию 7' },
        limit: { type: 'number', description: 'Сколько заголовков вернуть, по умолчанию 8' },
        fullText: {
          type: 'boolean',
          description:
            'Дочитать первые статьи целиком: медленнее, но даёт факты о причинах, а не только заголовки',
        },
        factors: {
          type: 'boolean',
          description:
            'Добавить публикации по факторам бумаги: нефть, курс, ставка, санкции — причины обычно отраслевые',
        },
        focus: {
          type: 'string',
          description: 'Текст вопроса: по нему ранжируются публикации (сначала самые близкие)',
        },
      },
    }) as never,
    func: async (input: unknown) => {
      const args = (input ?? {}) as {
        ticker?: string;
        days?: number;
        limit?: number;
        fullText?: boolean;
        factors?: boolean;
        focus?: string;
      };
      const ticker = typeof args.ticker === 'string' ? args.ticker.trim().toUpperCase() : '';
      const days = Number.isFinite(args.days) && Number(args.days) > 0 ? Number(args.days) : 7;
      const limit = Number.isFinite(args.limit) && Number(args.limit) > 0 ? Number(args.limit) : 8;
      // В лентах бумагу называют по имени и в разных падежах: «Лукойл вырос»,
      // «акции Лукойла». Без алиасов фильтр по тикеру «LKOH» ничего не находит.
      const names = (aliases[ticker] ?? [])
        .map((alias) => alias.trim())
        .filter((alias) => alias.length > 1);
      // Новости брокера ищутся по `TICKER_CLASSCODE`: по одному тикеру их не найти.
      const instrumentId =
        ticker && options.resolveInstrumentId
          ? await options.resolveInstrumentId(ticker).catch(() => undefined)
          : undefined;
      const result = await collectNewsDigest(options.registry, {
        tickers: ticker ? [ticker] : [],
        instrumentIds: instrumentId ? [instrumentId] : [],
        // Без тикера, но с темой в вопросе («новости по криптовалютам») фильтруем
        // сбор по словам темы: иначе приходит общая повестка.
        names: ticker ? names : (topicOf(typeof args.focus === 'string' ? args.focus : '')?.matchers ?? []),
        pages: options.scanPages,
        maxItems: Math.max(limit, options.maxItems > 0 ? Math.min(options.maxItems, 20) : limit),
      });
      // Оставляем один период: глубина задана параметром, а не четырьмя окнами.
      const items = result.periods
        .flatMap((period) => period.items)
        .filter((item, index, list) => list.findIndex((other) => other.title === item.title) === index);
      const fresh = filterByDays(items, days);
      // Индекс помнит публикации дольше, чем отдают ленты: это и есть «история
      // за период». Свежую выдачу сохраняем, сохранённую — дописываем.
      if (options.index) {
        options.index.save(
          fresh.map((item) => toStored(item, { tickers: ticker ? [ticker] : [] })),
        );
      }
      const remembered = options.index
        ? options.index.search({
            tickers: ticker ? [ticker] : [],
            sinceDays: days,
            limit: limit * 2,
          })
        : [];
      const seenIds = new Set<string>();
      const pool = [...fresh, ...remembered].filter((item) => {
        const id = storedId(item);
        if (seenIds.has(id)) {
          return false;
        }
        seenIds.add(id);
        return true;
      });
      // Порядок задаёт вопрос: редкие слова запроса поднимают нужные публикации,
      // остальные остаются ниже по свежести — без данных ответ не остаётся.
      const focus = typeof args.focus === 'string' ? args.focus.trim() : '';
      // Омонимы компании: «Самолёт» — и застройщик (SMLT), и авиация. Публикации
      // про рейсы и аэропорты к бумаге не относятся, а у бумаг с омонимом нужен
      // ещё и обязательный контекст: иначе лента авиации выдаётся за причины.
      const profiles = loadCompanyProfiles(options.profilesFile ?? 'data/company-profiles.yaml');
      const profile = ticker ? companyProfileOf(profiles, ticker) : undefined;
      const exclude = profile?.exclude ?? [];
      const context = profile?.context ?? [];
      const relevant = pool.filter((item) => {
        const haystack = `${item.title} ${item.summary ?? ''}`.toLowerCase();
        if (exclude.some((word) => haystack.includes(word.toLowerCase()))) {
          return false;
        }
        return context.length === 0 || context.some((word) => haystack.includes(word.toLowerCase()));
      });
      const recent = (focus ? rankByQuery(relevant, focus) : relevant).slice(0, limit);
      const title = ticker ? `Новости ${ticker} за ${days} дн.:` : `Новости рынка за ${days} дн.:`;
      const lines = [title];
      const summaryLimit = options.summaryLimit ?? 240;
      // Дочитывание статей: у публикации часто только намёк в заголовке, а причины
      // (нефть, сделка, дивиденды) — в тексте. Читаем первые статьи, не все.
      const readArticle = options.fetchText
        ? createArticleReader({
            fetchText: options.fetchText,
            maxChars: options.articleChars ?? 1_200,
          })
        : undefined;
      const articleChars = options.articleChars ?? 1_200;
      const articles = new Map<number, string | undefined>();
      if (args.fullText === true && readArticle) {
        // Читаем только публикации со ссылкой: у части источников её нет.
        const targets = recent
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => typeof item.url === 'string' && item.url.length > 0)
          .slice(0, options.articleLimit ?? 3);
        await Promise.all(
          targets.map(async ({ item, index }) => {
            // Текст, скачанный раньше (в том числе фоном), берём из индекса.
            const cached = options.index?.textOf(item.url);
            if (cached) {
              articles.set(index, cached);
              return;
            }
            const text = await readArticle(item.url, articleChars);
            if (text && item.url) {
              options.index?.saveText(item.url, text);
            }
            articles.set(index, text);
          }),
        );
      }

      recent.forEach((item, index) => {
        const head = `• ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`;
        // Аннотация — то, из чего делается вывод о причине: заголовок часто лишь намёк.
        const parts = [head];
        if (item.summary) {
          parts.push(`— ${clip(item.summary, summaryLimit)}`);
        }
        const body = articles.get(index);
        if (body) {
          parts.push(`¶ ${clip(body, articleChars)}`);
        }
        lines.push(clip(parts.join(' '), 1_600));
      });

      // Факторы: причины часто в публикациях, где бумага не названа («нефть выросла»,
      // «санкции ослабли»). Берём общую повестку и оставляем совпадения по драйверам.
      const missing = [...result.coverage];
      if (args.factors === true) {
        const profiles = loadCompanyProfiles(
          options.profilesFile ?? 'data/company-profiles.yaml',
        );
        const queries = factorsFor(ticker || undefined, profiles);
        if (queries.length > 0) {
          // Ищем публикации сразу по факторам: поиск по подстрокам поддерживают ленты,
          // поэтому «нефть», «Brent», «санкц» достают отраслевые новости из всей ленты,
          // а не только из верхушки общей повестки.
          const keywords = [...new Set(queries.flatMap((query) => query.keywords))];
          const general = await collectNewsDigest(options.registry, {
            names: keywords,
            pages: options.scanPages,
            maxItems: Math.max(options.maxItems, 30),
          });
          missing.push(...general.coverage);
          const factorItems = filterByDays(
            general.periods.flatMap((period) => period.items),
            days,
          );
          // Факторные публикации тоже копим: они объясняют и следующие вопросы.
          options.index?.save(factorItems.map((item) => toStored(item)));
          const rememberedFactors = options.index
            ? options.index.search({ keywords, sinceDays: days, limit: 40 })
            : [];
          const own = new Set(recent.map((item) => storedId(item)));
          const seen = new Set<string>();
          const pool = [...factorItems, ...rememberedFactors].filter((item) => {
            const id = storedId(item);
            if (own.has(id) || seen.has(id)) {
              return false;
            }
            seen.add(id);
            return true;
          });
          const matched = matchFactors(pool, queries).slice(0, options.factorLimit ?? 6);
          if (matched.length > 0) {
            lines.push(`Факторы (${queries.map((query) => query.title).join(', ')}):`);
            for (const { item } of matched) {
              const head = `• ${item.publishedAt.slice(0, 10)} [${item.source}] ${item.title}`;
              lines.push(item.summary ? `${head} — ${clip(item.summary, summaryLimit)}` : head);
            }
          }
        }
      }

      if (recent.length === 0) {
        lines.push('новостей нет');
      }
      const unavailable = missing.filter((entry) => entry.status === 'missing');
      if (unavailable.length > 0) {
        lines.push(
          `Недоступные источники: ${[...new Set(unavailable.map((entry) => entry.source))].join(', ')}`,
        );
      }
      return lines.join('\n');
    },
  } as never);
};

/** Оставляет новости не старше указанного числа дней. */
const filterByDays = <T extends { publishedAt: string }>(items: T[], days: number): T[] => {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  return items.filter((item) => Date.parse(item.publishedAt) >= since);
};
