import { Module } from '@nestjs/common';

/** Набор инструментов, доступных агенту (уже с неймспейсингом `<server>__<tool>`). */
export const MCP_TOOLS = Symbol('MCP_TOOLS');
/** Реестр MCP-серверов: статусы, discovery, повторное подключение. */
export const MCP_REGISTRY = Symbol('MCP_REGISTRY');

/** Реестр MCP-серверов реализуется в группе 3. */
@Module({})
export class ToolsModule {}
