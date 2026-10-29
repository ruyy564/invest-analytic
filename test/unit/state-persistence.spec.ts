import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { AppConfigService } from '../../src/config/app-config.service.js';
import type { AppConfig } from '../../src/config/configuration.js';
import { createCheckpointer } from '../../src/state/checkpointer.factory.js';
import { GlobalStoreService } from '../../src/state/global-store.service.js';

const stateConfig = (overrides: Partial<AppConfig['state']> = {}): AppConfig['state'] => ({
  backend: 'sqlite',
  sqlitePath: join(mkdtempSync(join(tmpdir(), 'state-')), 'state.sqlite'),
  ttlDays: 30,
  ...overrides,
});

const configStub = (state: AppConfig['state']): AppConfigService =>
  ({ value: { state } }) as unknown as AppConfigService;

describe('фабрика чекпоинтера', () => {
  it('для memory возвращает MemorySaver', () => {
    expect(createCheckpointer({ ...stateConfig(), backend: 'memory' })).toBeInstanceOf(MemorySaver);
  });

  it('для sqlite создаёт файл и SqliteSaver', () => {
    const state = stateConfig();
    const checkpointer = createCheckpointer(state);

    expect(checkpointer).toBeInstanceOf(SqliteSaver);
    expect(existsSync(state.sqlitePath)).toBe(true);
  });
});

describe('глобальное хранилище', () => {
  it('сохраняет данные между экземплярами и разделяет пространства имён', () => {
    const state = stateConfig();
    const first = new GlobalStoreService(configStub(state));
    first.put('users/alice', 'defaultAccountId', 'acc-1');
    first.put('users/bob', 'defaultAccountId', 'acc-2');
    first.close();

    const second = new GlobalStoreService(configStub(state));

    expect(second.get('users/alice', 'defaultAccountId')).toBe('acc-1');
    expect(second.get('users/bob', 'defaultAccountId')).toBe('acc-2');
    expect(second.get('users/carol', 'defaultAccountId')).toBeUndefined();
    expect(second.list('users/alice')).toHaveLength(1);

    second.delete('users/alice', 'defaultAccountId');
    expect(second.get('users/alice', 'defaultAccountId')).toBeUndefined();
    second.close();
  });

  it('запрещает хранить данные портфеля', () => {
    const store = new GlobalStoreService(configStub({ ...stateConfig(), backend: 'memory' }));

    expect(() => store.put('users/alice', 'portfolioSnapshot', {})).toThrow(/не может храниться/);
    expect(() => store.put('users/alice', 'lastPositions', [])).toThrow(/не может храниться/);
    store.close();
  });
});
