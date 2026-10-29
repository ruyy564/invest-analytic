import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { MemorySaver } from '@langchain/langgraph';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';
import type { BaseCheckpointSaver } from '@langchain/langgraph';
import type { AppConfig } from '../config/configuration.js';

/**
 * Чекпоинтер по конфигурации: `sqlite` переживает перезапуск,
 * `memory` нужен для тестов и локальных прогонов без файла.
 */
export const createCheckpointer = (state: AppConfig['state']): BaseCheckpointSaver => {
  if (state.backend === 'memory') {
    return new MemorySaver();
  }

  const directory = dirname(state.sqlitePath);
  if (directory && directory !== '.') {
    mkdirSync(directory, { recursive: true });
  }
  const saver = SqliteSaver.fromConnString(state.sqlitePath);
  // `setup()` защищён в типах, но нужен, чтобы таблицы существовали до очистки TTL.
  void (saver as unknown as { setup: () => Promise<void> }).setup();
  return saver;
};
