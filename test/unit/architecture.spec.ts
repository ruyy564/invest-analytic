import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');

const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? files(full) : full.endsWith('.ts') ? [full] : [];
  });

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);

/** Путь файла от `src`, с прямыми слэшами: удобно для правил. */
const relOf = (file: string): string => relative(SRC, file).split(sep).join('/');

/** Импорт превращается в путь от `src` (для относительных) или остаётся пакетом. */
const targetOf = (file: string, specifier: string): string | undefined => {
  if (!specifier.startsWith('.')) {
    return undefined;
  }
  const fromDir = relOf(file).split('/').slice(0, -1).join('/');
  const parts = `${fromDir}/${specifier}`.split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '.' || part === '') {
      continue;
    }
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/').replace(/\.js$/, '');
};

interface Rule {
  name: string;
  applies: (file: string) => boolean;
  forbidden: (target: string | undefined, specifier: string, filePath: string) => boolean;
  message: string;
}

const RULES: Rule[] = [
  {
    name: 'домен без фреймворка и сети',
    applies: (file) => /(^|\/)domain\//.test(file),
    forbidden: (target, specifier) =>
      target === undefined &&
      (/^@nestjs\//.test(specifier) ||
        /^@langchain\//.test(specifier) ||
        /^node:(fs|http|https)$/.test(specifier)),
    message: 'domain — чистый слой: без Nest, LangChain и ввода-вывода',
  },
  {
    name: 'возможность не зависит от оркестрации',
    applies: (file) => file.startsWith('capabilities/'),
    forbidden: (target) => target !== undefined && target.startsWith('agent/'),
    message: 'возможность не знает про агента: зависимость идёт только вниз',
  },
  {
    name: 'платформа не зависит от домена',
    applies: (file) => file.startsWith('platform/'),
    forbidden: (target) =>
      target !== undefined &&
      (target.startsWith('capabilities/') || target.startsWith('agent/')),
    message: 'platform — нижний слой: домен и агент его используют, а не наоборот',
  },
  {
    name: 'другая возможность — только через публичный вход',
    applies: (file) => file.startsWith('capabilities/'),
    forbidden: (target, specifier, filePath) => {
      if (!target || !target.startsWith('capabilities/')) {
        return false;
      }
      const [own] = filePath.slice('capabilities/'.length).split('/');
      const [other] = target.slice('capabilities/'.length).split('/');
      return own !== other && !specifier.endsWith('/index.js');
    },
    message: 'между возможностями импортируется только index.ts',
  },
];

/** Путь файла внутри правила: нужен, чтобы понять, к какой возможности он относится. */
const paths = new Map<string, string>();
const relOfFor = (file: string): string => {
  const cached = paths.get(file);
  if (cached) {
    return cached;
  }
  const value = relOf(file);
  paths.set(file, value);
  return value;
};

describe('границы модулей', () => {
  const all = files(SRC);

  it.each(RULES)('$name', (rule) => {
    const violations: string[] = [];

    for (const file of all) {
      const filePath = relOfFor(file);
      if (!rule.applies(filePath)) {
        continue;
      }
      for (const specifier of importsOf(file)) {
        const target = targetOf(file, specifier);
        if (rule.forbidden(target, specifier, filePath)) {
          violations.push(`${filePath} → ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
