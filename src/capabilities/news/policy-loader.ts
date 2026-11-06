import { readFileSync } from 'node:fs';
import { parseYaml } from '../../shared/parsing/yaml.js';
import { compileNewsPolicy, type NewsPolicy, type NewsPolicyRaw } from './domain/news-policy.js';

const cache = new Map<string, NewsPolicy>();

/**
 * Политика из файла: чтение и кэш живут вне домена — домен остаётся чистой
 * функцией оценки.
 */
export const loadNewsPolicy = (path = 'data/policy/news.yaml'): NewsPolicy => {
  const cached = cache.get(path);
  if (cached) {
    return cached;
  }
  const raw = parseYaml(readFileSync(path, 'utf8')) as unknown as NewsPolicyRaw;
  const policy = compileNewsPolicy(raw);
  cache.set(path, policy);
  return policy;
};

/** Сброс кэша: нужен тестам и правке политики без перезапуска. */
export const resetNewsPolicyCache = (): void => cache.clear();
