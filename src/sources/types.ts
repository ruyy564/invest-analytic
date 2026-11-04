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
  fetchNews(query: NewsQuery): Promise<SourceItem[]>;
}

/** Точка истории ключевой ставки: с какой даты действует значение. */
export interface KeyRatePoint {
  /** ISO-дата вступления решения в силу. */
  date: string;
  rate: number;
}

/** Снимок ключевой ставки: текущее значение, история и происхождение данных. */
export interface KeyRateSnapshot {
  current: KeyRatePoint;
  /** Изменения ставки, новые сверху. */
  history: KeyRatePoint[];
  /** `live` — SOAP ЦБ, `cache` — локальный кэш, `seed` — файл, `html` — таблица на сайте. */
  origin: 'live' | 'cache' | 'seed' | 'html';
  /** Когда данные фактически получены (ISO). */
  asOf: string;
}

export interface KeyRateSource {
  readonly id: string;
  /** `undefined` — данных нет ни в одном источнике цепочки. */
  read(): Promise<KeyRateSnapshot | undefined>;
}
