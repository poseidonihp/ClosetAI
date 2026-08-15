import { z } from 'zod';

const maxStorageKeyLength = 256;
const storageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)+$/;

export const StorageKeySchema = z
  .string()
  .min(1)
  .max(maxStorageKeyLength)
  .regex(storageKeyPattern, 'Key de almacenamiento inválida')
  .refine(key => !key.includes('..'), 'Key de almacenamiento inválida');
export type StorageKey = z.infer<typeof StorageKeySchema>;

export const MediaQuerySchema = z.object({
  key: StorageKeySchema,
});
export type MediaQuery = z.infer<typeof MediaQuerySchema>;
