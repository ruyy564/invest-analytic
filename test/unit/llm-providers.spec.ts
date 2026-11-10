import type { AppConfig } from '../../src/platform/config/configuration.js';
import { buildGigachatParams } from '../../src/platform/llm/providers/gigachat.provider.js';
import { buildOpenAiParams } from '../../src/platform/llm/providers/openai.provider.js';

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
    // По умолчанию без SSE-потока: с ним GigaChat иногда отдаёт битый чанк.
    streaming: false,
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
      streaming: false,
      // Пределы ответа: 1 024 токена обрезали разбор на середине, 15 с рвали транспорт.
      timeout: 45_000,
      maxTokens: 2_048,
      // Studio передаёт streaming-callbacks; без флага модель уходит в SSE.
      disableStreaming: true,
    });
    // Поток включается только явной настройкой окружения.
    const streaming = buildGigachatParams(
      llmConfig({ gigachat: { ...llmConfig().gigachat, streaming: true } }),
      'answer',
    );
    expect(streaming.streaming).toBe(true);
    expect(buildOpenAiParams(llmConfig({ temperature: 0.5 }), 'answer').temperature).toBe(0.5);
  });
});
