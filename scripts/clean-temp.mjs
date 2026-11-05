#!/usr/bin/env node
// Удаляет временные артефакты прогонов и сборки: логи, кеш tsc, дампы, профили браузера.
// Использование:
//   node scripts/clean-temp.mjs           — показать, что будет удалено
//   node scripts/clean-temp.mjs --yes     — удалить
//   node scripts/clean-temp.mjs --json    — машинный вывод (вместе с --check/--yes)
// Никогда не трогает код, данные, сертификаты и зависимости: список целей закрытый.
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const apply = args.has('--yes');
const json = args.has('--json');

/** Временные файлы в корне проекта: логи запусков, кеш сборки, дампы отладки. */
const TEMP_FILE_PATTERNS = [
  /\.log$/i,
  /\.tmp$/i,
  /\.tsbuildinfo$/i,
  /^health\.json$/i,
  /^sid\.txt$/i,
  /^rid\.txt$/i,
  /^tool-dump\.jsonl$/i,
  /^report\.md$/i,
  /^coverage\.json$/i,
];

/** Временные каталоги в корне проекта. */
const TEMP_DIRS = ['tmp', 'coverage', '.nyc_output', '.browser-profile', '.langgraph_api'];

/** Что нельзя удалять даже при совпадении шаблона. */
const PROTECTED = new Set([
  'node_modules',
  'dist',
  'certs',
  'data',
  'src',
  'test',
  'docs',
  'reports',
  'scripts',
  'openspec',
  '.git',
  '.vscode',
  '.agents',
]);

const sizeOf = (path) => {
  const info = statSync(path);
  if (!info.isDirectory()) {
    return info.size;
  }
  return readdirSync(path).reduce((total, name) => {
    try {
      return total + sizeOf(join(path, name));
    } catch {
      return total;
    }
  }, 0);
};

const formatSize = (bytes) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const targets = [];

for (const name of readdirSync(root)) {
  if (PROTECTED.has(name)) {
    continue;
  }
  const path = join(root, name);
  let info;
  try {
    info = statSync(path);
  } catch {
    continue;
  }

  const matchesFile = info.isFile() && TEMP_FILE_PATTERNS.some((pattern) => pattern.test(name));
  const matchesDir = info.isDirectory() && TEMP_DIRS.includes(name);
  if (!matchesFile && !matchesDir) {
    continue;
  }

  let size = 0;
  try {
    size = sizeOf(path);
  } catch {
    // Нечитаемый объект всё равно удаляем: он временный.
  }
  targets.push({ path, name, kind: info.isDirectory() ? 'dir' : 'file', size });
}

for (const target of targets) {
  if (apply) {
    rmSync(target.path, { recursive: true, force: true });
  }
}

if (json) {
  console.log(JSON.stringify({ applied: apply, targets }, null, 2));
} else if (targets.length === 0) {
  console.log('Временных файлов нет.');
} else {
  console.log(apply ? 'Удалены временные файлы:' : 'Будут удалены временные файлы:');
  for (const target of targets) {
    console.log(`  ${target.kind === 'dir' ? 'каталог' : 'файл'} ${target.name} (${formatSize(target.size)})`);
  }
  const total = targets.reduce((sum, target) => sum + target.size, 0);
  console.log(
    apply
      ? `Итого: ${targets.length}, освобождено ${formatSize(total)}.`
      : `Итого: ${targets.length}, ${formatSize(total)}. Для удаления запустите с --yes.`,
  );
}
