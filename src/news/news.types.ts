/** Тема, которую обслуживает источник данных. */
export type SourceTopic = 'portfolio' | 'news' | 'tax' | 'macro' | 'market';

/** Единый элемент новостной ленты любого источника. */
export interface SourceItem {
  id: string;
  title: string;
  summary?: string;
  url?: string;
  /** ISO 8601. */
  publishedAt: string;
  tags: string[];
  /** id источника, из которого пришёл элемент. */
  source: string;
}

export interface NewsQuery {
  /** Тикеры, по которым нужны новости; пусто — общая лента. */
  tickers?: string[];
  /**
   * Подстроки для фильтра общей ленты: тикер и название компании. Ленты
   * (РБК, «Интерфакс») не умеют искать по бумаге, но могут отфильтровать
   * заголовки — так в отчёт не попадают спорт и политика.
   */
  matchers?: string[];
  /** Сколько страниц ленты максимум листать. */
  pages: number;
  /** Сколько элементов оставить на одну выборку. */
  maxItems: number;
  /** Граница «свежих» новостей в днях: всё старше отбрасывается. */
  sinceDays?: number;
}

/** Источник новостей: RSS/Atom-лента или инструмент брокера. */
export interface NewsSourceAdapter {
  readonly id: string;
  readonly topics: readonly SourceTopic[];
  /**
   * Источник умеет искать новости по конкретной бумаге. Общие ленты (РБК,
   * «Интерфакс», Smart-lab) этого не умеют — при запросе по тикерам их
   * ответы не относятся к портфелю и в сводку не попадают.
   */
  readonly supportsTickerQuery?: boolean;
  /** Источник умеет фильтровать общую ленту по подстрокам (`matchers`). */
  readonly supportsMatcherQuery?: boolean;
  fetchNews(query: NewsQuery): Promise<SourceItem[]>;
}

