/**
 * Публичный API схемы окружения: константы, разбор MCP-серверов, схема скалярных
 * переменных. Сами секции схемы живут в `./env/`.
 */
export * from './env/env.constants.js';
export * from './env/env.mcp.js';
export {
  scalarEnvObject,
  scalarEnvSchema,
  SCALAR_ENV_KEYS,
} from './env/env.scalar.js';
export type { ScalarEnv } from './env/env.scalar.js';
