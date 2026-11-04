/**
 * Точка входа для LangSmith Studio (`npm run studio`), аналог `investServer.ts`
 * из примера курса: рабочий граф сервиса, без заглушек.
 *
 * Граф собирается тем же `buildAgentGraph`, что и в NestJS-сервисе, из тех же
 * узлов (`classify`, `offTopic`, `agent`, `approve`, `tools`), с моделями
 * провайдера из `.env`, MCP-инструментами (allowlist, прокси, бюджет вызовов)
 * и правилами подтверждений. Чекпоинтер не передаётся: персистентность треда
 * держит сам dev-сервер LangGraph, поэтому чат в Studio видит историю, а пауза
 * `interrupt` в `approve` возобновляется из панели Interrupts.
 */
import { graphForServer } from './agent-runtime.js';

export const graph = await graphForServer();
