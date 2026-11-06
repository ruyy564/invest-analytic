import 'reflect-metadata';
/**
 * Возможность «рынок»: ключевая ставка ЦБ и учётные цены металлов. Публичный
 * вход для других возможностей и узлов.
 */
export * from './key-rate/key-rate.factory.js';
export * from './key-rate/key-rate.types.js';
export * from './commodities/commodity.factory.js';
export * from './commodities/commodity.types.js';
export * from './commodities/commodity.links.js';
export * from './tools/key-rate/key-rate.service.js';
export * from './tools/commodity/commodity.service.js';
export { createKeyRateTool } from './tools/key-rate/key-rate.tool.js';
export { createCommodityTool } from './tools/commodity/commodity.tool.js';
