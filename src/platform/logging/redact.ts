const BEARER = /(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi;
const SECRET_KEY = /(token|authorization|api[-_]?key|secret|password|credential)/i;

/** Маска секрета: оставляем только края, чтобы можно было опознать значение. */
export const maskSecret = (value: string): string =>
  value.length <= 6 ? '***' : `${value.slice(0, 2)}***${value.slice(-2)}`;

export const redactString = (value: string): string =>
  value.replace(BEARER, '$1***');

export const redactSecret = (value: string): string => maskSecret(value);

/** Рекурсивно маскирует секретные поля и заголовки авторизации. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6) {
    return '[обрезано]';
  }
  if (typeof value === 'string') {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] =
        SECRET_KEY.test(key) && typeof item === 'string' ? maskSecret(item) : redact(item, depth + 1);
    }
    return result;
  }
  return value;
};
