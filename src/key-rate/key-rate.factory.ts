import type { AppConfig } from '../config/configuration.js';
import { createCbrSource } from './key-rate.cbr.js';
import { KeyRateCache } from './key-rate.cache.js';
import type { KeyRateSource } from './key-rate.types.js';

export interface KeyRateFactoryDeps {
  config: AppConfig;
  /** Подмена загрузчика в тестах. */
  fetchText?: (url: string, init?: RequestInit) => Promise<string>;
}

/**
 * Источник ключевой ставки по конфигурации: ЦБ (SOAP), кэш, сид-файл или HTML.
 * Новостей здесь нет — только ставка.
 */
export const buildKeyRateSource = (deps: KeyRateFactoryDeps): KeyRateSource | undefined => {
  const { config } = deps;
  if (!config.sources.enabled.includes('cbr')) {
    return undefined;
  }
  return createCbrSource({
    mode: config.sources.keyRate.mode,
    soapUrl: config.sources.keyRate.soapUrl,
    htmlUrl: config.sources.keyRate.htmlUrl,
    seedFile: config.sources.keyRate.seedFile,
    cache: new KeyRateCache(
      config.state.backend === 'sqlite' ? config.state.sqlitePath : ':memory:',
      config.sources.keyRate.cacheTtlHours,
    ),
    fetchText: deps.fetchText,
  });
};
