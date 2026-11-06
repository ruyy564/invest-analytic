/** Возможность «инструменты»: фасады MCP и динамика цены. */
export { invokeTool, type ToolLookup } from './tools/facade.js';
export {
  INSTRUMENT_TOOLS,
  createInstrumentTools,
  type InstrumentToolsOptions,
} from './tools/instruments.tools.js';
export { mapCandles, type PricePoint } from './tools/price-dynamics/price-dynamics.service.js';
export { createPriceDynamicsTool } from './tools/price-dynamics/price-dynamics.tool.js';
