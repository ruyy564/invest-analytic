/** Ответ MCP-сервера в виде JSON: строка разбирается, контент-блок — рекурсивно. */
export const asJson = (raw: unknown): unknown => {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return raw;
    }
  }
  if (Array.isArray(raw) && raw.length === 1 && typeof raw[0] === 'object' && raw[0] !== null) {
    // Адаптер MCP может вернуть контент-блоки одной строкой.
    const [first] = raw as { text?: string }[];
    if (typeof first?.text === 'string') {
      return asJson(first.text);
    }
  }
  return raw;
};
