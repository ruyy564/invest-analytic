/**
 * Значения SSR-состояния страницы: Next.js складывает его в
 * `<script type="application/json">` (у РБК — с id `__NEXT_DATA__`), Tramvai —
 * в такие же блоки со стейтами стора. HTML-парсер на регулярках тут уместен:
 * нужен только сам JSON, а не разметка.
 */
export const jsonScriptsOf = (html: string): unknown[] => {
  const blocks = html.matchAll(
    /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  const values: unknown[] = [];
  for (const block of blocks) {
    try {
      values.push(JSON.parse(block[1]));
    } catch {
      // Битый или неполный блок — не повод терять остальные.
    }
  }
  return values;
};

/** Объект по значению неизвестного типа: `undefined`, если это не запись. */
export const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/** Непустая строка из значения неизвестного типа. */
export const asString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
