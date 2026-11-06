/**
 * Транспорты: входы процесса. HTTP-контроллеры и MCP-клиент. Бизнес-логики
 * здесь нет — только адаптеры к внешнему миру.
 */
export * from './mcp/mcp.module.js';
export * from './http/api.module.js';
