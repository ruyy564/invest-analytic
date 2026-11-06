import { UNKNOWN_SECTOR } from './sector.js';
import type { SectionOutput } from './engine.types.js';

/** Секторы, под которые подбирается справочный блок: из структуры или из бумаг. */
export const sectorsOf = (sections: readonly SectionOutput[]): string[] => {
  const structure = sections.find((section) => section.id === 'structure')?.structured as
    | { bySector?: { name: string }[] }
    | undefined;
  const fromStructure = (structure?.bySector ?? [])
    .map((row) => row.name)
    .filter((name) => name.length > 0 && name !== UNKNOWN_SECTOR);
  if (fromStructure.length > 0) {
    return [...new Set(fromStructure)];
  }

  // Разбор бумаги: структуры портфеля нет, сектор берём из её карточки.
  const securities = sections.find((section) => section.id === 'securities')?.structured as
    | { sector?: string }[]
    | undefined;
  return [
    ...new Set(
      (securities ?? [])
        .map((security) => security.sector)
        .filter((sector): sector is string => !!sector && sector !== UNKNOWN_SECTOR),
    ),
  ];
};

