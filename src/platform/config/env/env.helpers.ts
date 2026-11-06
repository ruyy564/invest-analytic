import { z } from 'zod';

export const flag = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === '' ? String(def) : value.trim()))
    .pipe(z.enum(['true', 'false'], { message: 'ожидается true или false' }))
    .transform((value) => value === 'true');

export const csv = (field: string) =>
  z
    .string({ message: `${field} обязателен` })
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    )
    .refine((items) => items.length > 0, { message: `${field} не должен быть пустым` });

/** CSV-список, который может быть пустым: `SOURCES=` означает «только брокер». */
export const csvList = (def: string) =>
  z
    .string()
    .default(def)
    .transform((value) =>
      value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    );

export const url = (field: string) =>
  z.string().refine(
    (value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    },
    { message: `${field} должен быть корректным URL` },
  );
