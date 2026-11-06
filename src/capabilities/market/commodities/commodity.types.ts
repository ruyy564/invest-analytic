/** Драгоценные металлы, по которым ЦБ публикует учётные цены. */
export type MetalCode = 'gold' | 'silver' | 'platinum' | 'palladium';

/** Учётная цена металла ЦБ: рубли за грамм на конкретную дату. */
export interface MetalQuote {
  metal: MetalCode;
  /** Цена за грамм, RUB. */
  price: number;
  /** Дата котировки, `ДД.ММ.ГГГГ`. */
  date: string;
}

/** Снимок цен металлов: набор котировок и происхождение данных. */
export interface CommoditySnapshot {
  quotes: MetalQuote[];
  /** `live` — XML ЦБ, `cache` — значение из памяти процесса. */
  origin: 'live' | 'cache';
  asOf: string;
}

/** Источник цен металлов: ЦБ РФ через XML котировок. */
export interface CommoditySource {
  readonly id: string;
  /** `undefined` — источник не ответил и кэша нет. */
  read(): Promise<CommoditySnapshot | undefined>;
}
