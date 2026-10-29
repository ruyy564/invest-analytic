import type { AppConfig } from '../../src/config/configuration.js';
import { buildGigachatParams } from '../../src/llm/providers/gigachat.provider.js';
import { buildOpenAiParams } from '../../src/llm/providers/openai.provider.js';

const llmConfig = (overrides: Partial<AppConfig['llm']> = {}): AppConfig['llm'] => ({
  provider: 'openai',
  model: 'gpt-4o-mini',
  routerModel: 'gpt-router',
  temperature: 0.2,
  apiKey: 'test-key',
  gigachat: {
    credentials: 'cred',
    scope: 'GIGACHAT_API_PERS',
    authUrl: 'https://auth.example.com/oauth',
  },
  ...overrides,
});

describe('параметры провайдеров', () => {
  it('выбирает модель по роли', () => {
    expect(buildOpenAiParams(llmConfig(), 'answer').model).toBe('gpt-4o-mini');
    expect(buildOpenAiParams(llmConfig(), 'router').model).toBe('gpt-router');
    expect(buildGigachatParams(llmConfig(), 'answer').model).toBe('gpt-4o-mini');
    expect(buildGigachatParams(llmConfig(), 'router').model).toBe('gpt-router');
  });

  it('передаёт baseURL только когда он задан', () => {
    expect(buildOpenAiParams(llmConfig(), 'answer').configuration).toBeUndefined();

    const compatible = buildOpenAiParams(
      llmConfig({ provider: 'openai-compatible', baseUrl: 'https://llm.example.com/v1' }),
      'answer',
    );
    expect(compatible.configuration).toEqual({ baseURL: 'https://llm.example.com/v1' });
  });

  it('переносит креденшелы GigaChat и температуру', () => {
    const params = buildGigachatParams(llmConfig({ provider: 'gigachat', temperature: 0.5 }), 'answer');
    expect(params).toEqual({
      credentials: 'cred',
      scope: 'GIGACHAT_API_PERS',
      authUrl: 'https://auth.example.com/oauth',
      model: 'gpt-4o-mini',
    });
    expect(buildOpenAiParams(llmConfig({ temperature: 0.5 }), 'answer').temperature).toBe(0.5);
  });
});
