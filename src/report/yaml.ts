/**
 * Минимальный разборщик YAML для файлов-шаблонов: комментарии, вложенные
 * отображения, блочные списки, скаляры и однострочные массивы `[a, b]`.
 * Полноценный YAML не нужен: шаблон отчёта — это данные, а не язык.
 */
export type YamlValue = string | number | boolean | null | YamlValue[] | { [key: string]: YamlValue };

const stripComment = (line: string): string => {
  // Комментарий начинается с # в начале строки или после пробела вне кавычек.
  let inSingle = false;
  let inDouble = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (char === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (char === '#' && !inSingle && !inDouble) {
      if (index === 0 || /\s/.test(line[index - 1])) {
        return line.slice(0, index).trimEnd();
      }
    }
  }
  return line.trimEnd();
};

export const parseScalar = (raw: string): YamlValue => {
  const value = raw.trim();
  if (value === '' || value === 'null' || value === '~') {
    return null;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(value)) {
    return Number.parseInt(value, 10);
  }
  if (/^-?\d+\.\d+$/.test(value)) {
    return Number.parseFloat(value);
  }
  if (value.startsWith('[') && value.endsWith(']')) {
    const inner = value.slice(1, -1).trim();
    return inner === ''
      ? []
      : inner
          .split(',')
          .map((part) => parseScalar(part))
          .filter((part): part is YamlValue => part !== null);
  }
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
};

interface Line {
  indent: number;
  text: string;
}

const toLines = (text: string): Line[] =>
  text
    .split(/\r?\n/)
    .map((raw) => stripComment(raw))
    .filter((raw) => raw.trim() !== '')
    .map((raw) => ({ indent: raw.length - raw.trimStart().length, text: raw.trim() }));

const splitKey = (text: string): [string, string] | undefined => {
  const index = text.indexOf(':');
  if (index <= 0) {
    return undefined;
  }
  return [text.slice(0, index).trim(), text.slice(index + 1).trim()];
};

const parseBlock = (lines: Line[], start: number, indent: number): [YamlValue, number] => {
  const isSequence = lines[start].text.startsWith('- ');
  const container: YamlValue[] | Record<string, YamlValue> = isSequence ? [] : {};
  let index = start;

  const childOf = (parent: Line, skip: number): [YamlValue, number] => {
    const next = lines[skip];
    if (next && next.indent > parent.indent) {
      return parseBlock(lines, skip, next.indent);
    }
    return [null, skip];
  };

  while (index < lines.length && lines[index].indent === indent) {
    const line = lines[index];

    if (isSequence) {
      if (!line.text.startsWith('- ')) {
        break;
      }
      const rest = line.text.slice(2).trim();
      const pair = splitKey(rest);
      if (!pair) {
        (container as YamlValue[]).push(parseScalar(rest));
        index += 1;
        continue;
      }

      const [key, value] = pair;
      const item: Record<string, YamlValue> = {};
      if (value === '' && lines[index + 1] && lines[index + 1].indent > line.indent) {
        const [child, next] = parseBlock(lines, index + 1, lines[index + 1].indent);
        item[key] = child;
        index = next;
      } else {
        item[key] = parseScalar(value);
        index += 1;
      }

      // Продолжение элемента-объекта на строках с отступом больше, чем у «- ».
      while (index < lines.length && lines[index].indent > line.indent) {
        const nested = lines[index];
        const nestedPair = splitKey(nested.text);
        if (!nestedPair) {
          index = lines.length;
          break;
        }
        const [nestedKey, nestedValue] = nestedPair;
        if (nestedValue === '') {
          const [child, next] = childOf(nested, index + 1);
          item[nestedKey] = child;
          index = next;
        } else {
          item[nestedKey] = parseScalar(nestedValue);
          index += 1;
        }
      }
      (container as YamlValue[]).push(item);
      continue;
    }

    const pair = splitKey(line.text);
    if (!pair) {
      index += 1;
      continue;
    }
    const [key, value] = pair;
    if (value === '') {
      const [child, next] = childOf(line, index + 1);
      (container as Record<string, YamlValue>)[key] = child;
      index = next;
    } else {
      (container as Record<string, YamlValue>)[key] = parseScalar(value);
      index += 1;
    }
  }

  return [container, index];
};

/** Разбор YAML-подмножества; пустой документ — `null`. */
export const parseYaml = (text: string): YamlValue => {
  const lines = toLines(text);
  if (lines.length === 0) {
    return null;
  }
  const [value] = parseBlock(lines, 0, lines[0].indent);
  return value;
};
