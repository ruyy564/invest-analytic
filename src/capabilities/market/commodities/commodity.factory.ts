import type { AppConfig } from '../../../platform/config/configuration.js';
import { createCbrCommoditySource } from './commodity.cbr.js';
import type { CommoditySource } from './commodity.types.js';

export interface CommodityFactoryDeps {
  config: AppConfig;
  /** Подмена загрузчика в тестах. */
  fetchXml?: (url: string) => Promise<string>;
}

/**
 * Источник цен металлов: включается вместе с ЦБ, потому что учётные цены
 * драгметаллов публикует именно ЦБ.
 */
export const buildCommoditySource = (deps: CommodityFactoryDeps): CommoditySource | undefined => {
  if (!deps.config.sources.enabled.includes('cbr')) {
    return undefined;
  }
  return createCbrCommoditySource({ fetchXml: deps.fetchXml });
};
