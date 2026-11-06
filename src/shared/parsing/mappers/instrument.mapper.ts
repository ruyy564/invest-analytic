import { McpInvalidResponseError } from '../../../transports/mcp/errors.js';

export interface InstrumentRef {
  uid: string;
  /** Идентификатор позиции: не путать с `uid` бумаги. */
  positionUid?: string;
  ticker: string;
  name: string;
  classCode?: string;
  isin?: string;
}

export interface InstrumentSource {
  uid?: string;
  positionUid?: string;
  ticker?: string;
  name?: string;
  classCode?: string;
  isin?: string;
}

/** Разбирает бумагу из ответа MCP; без `uid`/`ticker`/`name` данные считаются некорректными. */
export const mapInstrument = (source: InstrumentSource): InstrumentRef => {
  if (!source.uid || !source.ticker || !source.name) {
    throw new McpInvalidResponseError('В ответе MCP нет uid, ticker или name бумаги');
  }
  return {
    uid: source.uid,
    positionUid: source.positionUid,
    ticker: source.ticker.toUpperCase(),
    name: source.name,
    classCode: source.classCode,
    isin: source.isin,
  };
};
