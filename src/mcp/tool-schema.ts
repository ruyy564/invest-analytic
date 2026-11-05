// Схемы инструментов строятся на zod 3: GigaChat конвертирует их через zod-to-json-schema.
import { z } from 'zod/v3';

export interface ToolSchemaInfo {
  name: string;
  description?: string;
  required: string[];
}

/**
 * MCP отдаёт JSON-схему аргументов как строку. Возвращаем её объектом,
 * чтобы построить из неё zod-схему (zod 3) для провайдеров моделей.
 */
export const toolSchemaFrom = (schema: unknown): Record<string, unknown> => {
  if (typeof schema === 'string') {
    try {
      return JSON.parse(schema) as Record<string, unknown>;
    } catch {
      return { type: 'object', properties: {} };
    }
  }
  if (schema && typeof schema === 'object') {
    return schema as Record<string, unknown>;
  }
  return { type: 'object', properties: {} };
};

interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: unknown[];
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
}

/**
 * Конвертация JSON Schema (из MCP) в zod 3: нужна потому, что GigaChat
 * конвертирует схемы инструментов через zod-to-json-schema, а он понимает
 * только zod 3. Без этого модель не видит обязательные аргументы.
 */
export const toZodV3 = (raw: unknown): z.ZodTypeAny => {
  const schema = raw as JsonSchema | undefined;
  if (!schema || typeof schema !== 'object') {
    return z.record(z.any());
  }

  const variants = schema.anyOf ?? schema.oneOf;
  if (variants && variants.length > 0) {
    const mapped = variants.map((variant) => toZodV3(variant));
    return mapped.length === 1 ? mapped[0] : z.union(mapped as never);
  }

  switch (schema.type) {
    case 'object':
      return objectSchema(schema);
    case 'array':
      return schema.items ? z.array(toZodV3(schema.items)) : z.array(z.any());
    case 'string':
      return schema.enum
        ? z.enum(schema.enum.map(String) as [string, ...string[]])
        : z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    default:
      return z.any();
  }
};

const objectSchema = (schema: JsonSchema): z.ZodTypeAny => {
  const shape: Record<string, z.ZodTypeAny> = {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  for (const [key, value] of Object.entries(schema.properties ?? {})) {
    const field = toZodV3(value);
    const described = value?.description ? field.describe(value.description) : field;
    shape[key] = required.has(key) ? described : described.optional();
  }

  // Пустой объект: принимаем любые аргументы, чтобы не ломать вызовы без параметров.
  return Object.keys(shape).length === 0 ? z.object({}).passthrough() : z.object(shape);
};

