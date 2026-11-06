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

/** Источник ставки: ЦБ через SOAP, кэш, сид-файл или HTML-таблицу. */
export interface KeyRateSource {
  readonly id: string;
  /** `undefined` — данных нет ни в одном источнике цепочки. */
  read(): Promise<KeyRateSnapshot | undefined>;
}
