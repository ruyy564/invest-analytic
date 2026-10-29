import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import { AppConfigService } from '../../src/config/app-config.service.js';
import type { AppConfig } from '../../src/config/configuration.js';
import { createCheckpointer } from '../../src/state/checkpointer.factory.js';
import { CleanupService } from '../../src/state/cleanup.service.js';
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

describe('очистка устаревших сессий', () => {
  it('удаляет чекпоинты старше STATE_TTL_DAYS и не трогает свежие', async () => {
    const state = stateConfig({ ttlDays: 1 });
    void (SqliteSaver.fromConnString(state.sqlitePath) as unknown as { setup: () => Promise<void> }).setup();
    await new Promise((resolve) => setTimeout(resolve, 300));

    const db = new Database(state.sqlitePath);
    const insert = db.prepare(
      'INSERT INTO checkpoints (thread_id, checkpoint_ns, checkpoint_id, type, checkpoint, metadata) VALUES (?, ?, ?, ?, ?, ?)',
    );
    const insertWrite = db.prepare(
      'INSERT INTO writes (thread_id, checkpoint_ns, checkpoint_id, task_id, idx, channel, value) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const old = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
    const fresh = new Date().toISOString();

    insert.run('old', '', old, 'json', '{}', '{}');
    insert.run('fresh', '', fresh, 'json', '{}', '{}');
    insertWrite.run('old', '', old, 'task', 0, 'channel', '{}');
    db.close();

    const cleanup = new CleanupService(
      configStub(state),
      new GlobalStoreService(configStub({ ...state, backend: 'memory' })),
    );
    const removed = cleanup.cleanup(new Date());

    expect(removed).toBe(1);

    const check = new Database(state.sqlitePath);
    const remaining = check
      .prepare('SELECT thread_id FROM checkpoints')
      .all()
      .map((row) => (row as { thread_id: string }).thread_id);
    const writes = check.prepare('SELECT thread_id FROM writes').all();
    check.close();

    expect(remaining).toEqual(['fresh']);
    expect(writes).toHaveLength(0);
  });

  it('ничего не делает в memory-режиме', () => {
    const cleanup = new CleanupService(
      configStub({ ...stateConfig(), backend: 'memory' }),
      new GlobalStoreService(configStub({ ...stateConfig(), backend: 'memory' })),
    );

    expect(cleanup.cleanup()).toBe(0);
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
