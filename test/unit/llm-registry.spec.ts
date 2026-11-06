import { ChatOpenAI } from '@langchain/openai';
import { AppConfigService } from '../../src/platform/config/app-config.service.js';
import { ConfigError } from '../../src/platform/config/config.error.js';
import type { AppConfig } from '../../src/platform/config/configuration.js';
import { LlmRegistry, createProviderMap } from '../../src/platform/llm/llm-registry.js';
import { FakeLlmProvider, ScriptedChatModel } from '../fixtures/fake-chat-model.js';

const llmSection = (provider: string): AppConfig['llm'] => ({
  provider: provider as AppConfig['llm']['provider'],
  model: 'gpt-4o-mini',
  routerModel: 'gpt-router',
  temperature: 0.2,
  apiKey: 'test-key',
  gigachat: {
    credentials: 'cred',
    scope: 'GIGACHAT_API_PERS',
    authUrl: 'https://auth.example.com/oauth',
  },
});

const configStub = (provider: string): AppConfigService =>
  ({ value: { llm: llmSection(provider) } }) as unknown as AppConfigService;

describe('реестр LLM-провайдеров', () => {
  it('создаёт модель выбранного провайдера', () => {
    const registry = new LlmRegistry(configStub('openai'));

    expect(registry.providerId).toBe('openai');
    expect(registry.createChatModel('answer')).toBeInstanceOf(ChatOpenAI);
  });

  it('падает на неизвестном провайдере и перечисляет поддерживаемые', () => {
    const registry = new LlmRegistry(configStub('ollama'));

    expect(() => registry.provider).toThrow(ConfigError);
    expect(() => registry.provider).toThrow(/ollama/);
    expect(() => registry.provider).toThrow(/gigachat, openai, openai-compatible/);
  });

  it('позволяет подключить тестовый провайдер', () => {
    const providers = createProviderMap(llmSection('fake'), [new FakeLlmProvider(['готово'])]);

    expect(providers.has('fake')).toBe(true);
    expect(providers.get('fake')?.createChatModel('answer')).toBeInstanceOf(ScriptedChatModel);
  });
});
