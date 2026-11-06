import { resultsInGroup } from '../../collection/executor.js';
import type { FactContext } from '../../engine.js';
import { sectorByTicker } from '../../sector.js';

/** Сектор по тикерам из собранного справочника активов. */
export const sectorMapOf = (ctx: FactContext): Map<string, string> =>
  sectorByTicker(
    resultsInGroup(ctx.plan, ctx.collected, 'reference').map(({ entry, text }) => ({
      target: entry.target,
      text,
    })),
  );
