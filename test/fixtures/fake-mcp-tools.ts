import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';

/** Инструмент MCP для тестов: имя, схема-пустышка и подменяемая реализация. */
export const fakeTool = (
  name: string,
  impl: (input: unknown) => Promise<unknown> = async () => 'ok',
): DynamicStructuredTool =>
  new DynamicStructuredTool({
    name,
    description: `${name} — инструмент для тестов`,
    schema: z.object({}),
    func: impl,
  } as never);
