/**
 * Область разбора: весь портфель, конкретный счёт или конкретная бумага.
 * Определяется по тексту вопроса детерминированно — модель тут ошибается чаще.
 */
export const SCOPES = ['portfolio', 'account', 'instrument'] as const;
export type ReviewScope = (typeof SCOPES)[number];

export interface ScopeTarget {
  scope: ReviewScope;
  /** Тикер для бумаги, идентификатор/название счёта для счёта. */
  target?: string;
  /** Готовая подпись для отчёта и запроса подтверждения. */
  label: string;
}

export const PORTFOLIO_SCOPE: ScopeTarget = { scope: 'portfolio', label: 'портфеля' };

/** Тикер в тексте: SBER, PLZL, X5. */
const TICKER_TOKEN = /\b([A-Z][A-Z0-9]{1,4})\b/;

/** Слова про счёт и номер/название сразу после них. */
const ACCOUNT_WORDS =
  /(?:счёт|счет|счёту|счету|счёта|счета|счетам|счётам)\s*([A-Za-zА-Яа-я0-9*_-]{4,})/i;

/** Слова про конкретную бумагу. */
const INSTRUMENT_WORDS = /бумаг|акци|тикер|эмитент|инструмент|по\s+компании/i;

/**
 * Область разбора по тексту вопроса.
 * - «разбери счёт Портфельное инвестирование» → счёт;
 * - «проанализируй Сбер / SBER» → бумага;
 * - «проанализируй портфель» → портфель.
 * Алиасы эмитентов (`data/ticker-aliases.yaml`) расширяют распознавание имён.
 */
export const detectScope = (
  text: string,
  aliases: Record<string, readonly string[]> = {},
): ScopeTarget => {
  const account = ACCOUNT_WORDS.exec(text);
  if (account?.[1]) {
    const target = account[1];
    return { scope: 'account', target, label: `счёта ${target}` };
  }

  const ticker = TICKER_TOKEN.exec(text);
  if (ticker?.[1]) {
    const upper = ticker[1].toUpperCase();
    // Одиночные латинские слова вроде «OK», «CRM» бумагой не считаем: нужен
    // либо явный маркер («по SBER», «бумага SBER»), либо тикер из портфеля.
    const known = Object.keys(aliases).includes(upper);
    if (known || INSTRUMENT_WORDS.test(text)) {
      return { scope: 'instrument', target: upper, label: `бумаги ${upper}` };
    }
  }

  const lower = text.toLowerCase();
  for (const [aliasTicker, values] of Object.entries(aliases)) {
    const hit = values.some((value) => {
      const normalized = value.toLowerCase();
      return normalized.length > 2 && lower.includes(normalized);
    });
    if (hit) {
      return { scope: 'instrument', target: aliasTicker, label: `бумаги ${aliasTicker}` };
    }
  }

  return PORTFOLIO_SCOPE;
};
