import { mkdirSync } from 'node:fs';
import { SqliteSaver } from '@langchain/langgraph-checkpoint-sqlite';

mkdirSync('./data', { recursive: true });
await SqliteSaver.fromConnString('./data/state.sqlite').setup();
const saver = SqliteSaver.fromConnString('./data/state.sqlite');
const db = saver.db;

const tables = db
  .prepare("select name from sqlite_master where type='table'")
  .all()
  .map((row) => row.name);
console.log('tables:', tables.join(','));

for (const table of tables) {
  const columns = db
    .prepare(`pragma table_info(${table})`)
    .all()
    .map((column) => column.name);
  console.log(`${table}:`, columns.join(','));
}
