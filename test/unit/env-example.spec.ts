import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCALAR_ENV_KEYS } from '../../src/config/env.schema.js';
import { loadConfiguration } from '../../src/config/configuration.js';

const examplePath = join(import.meta.dirname, '..', '..', '.env.example');

const readExample = (): Map<string, string> => {
  const content = readFileSync(examplePath, 'utf8');
  const result = new Map<string, string>();
  for (const line of content.split(/\r?\n/)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) {
      result.set(match[1], match[2]);
    }
  }
  return result;
};

describe('.env.example', () => {
  const values = readExample();
  const actualKeys = new Set(values.keys());
  const serverNames = (values.get('MCP_SERVERS') ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0);

  const expectedKeys = new Set<string>([
    ...SCALAR_ENV_KEYS,
    ...serverNames.flatMap((name) => {
      const prefix = `MCP_${name.toUpperCase()}_`;
      return [`${prefix}URL`, `${prefix}TRANSPORT`, `${prefix}TOKEN`, `${prefix}ALLOWED_TOOLS`];
    }),
  ]);

  it('содержит все ключи схемы и не содержит лишних', () => {
    expect([...actualKeys].sort()).toEqual([...expectedKeys].sort());
  });

  it('после заполнения обязательных значений проходит валидацию схемы', () => {
    const env: NodeJS.ProcessEnv = Object.fromEntries(values.entries());
    env.LLM_API_KEY = 'test-key';
    env.LLM_BASE_URL = 'https://llm.example.com/v1';
    env.MCP_TINKOFF_URL = 'https://mcp.example.com/mcp';

    expect(() => loadConfiguration(env)).not.toThrow();
  });
});
