import { z } from 'zod';
import {
  CUSTOM_ALIAS_MAX_LENGTH,
  CUSTOM_ALIAS_MIN_LENGTH,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  MAX_URL_LENGTH,
  RESERVED_SHORT_CODES,
} from './constants.js';

const ALIAS_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Accepts only absolute http(s) URLs.
 *
 * Zod's built-in url check is deliberately not used: it would accept
 * `javascript:` and `data:` URLs, which become stored-XSS vectors the moment
 * we emit the destination into a Location header or an anchor href.
 */
export const destinationUrlSchema = z
  .string()
  .trim()
  .min(1, 'URL is required')
  .max(MAX_URL_LENGTH, `URL must be at most ${MAX_URL_LENGTH} characters`)
  .refine((value) => {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  }, 'Must be an absolute http(s) URL');

export const customAliasSchema = z
  .string()
  .trim()
  .min(CUSTOM_ALIAS_MIN_LENGTH, `Alias must be at least ${CUSTOM_ALIAS_MIN_LENGTH} characters`)
  .max(CUSTOM_ALIAS_MAX_LENGTH, `Alias must be at most ${CUSTOM_ALIAS_MAX_LENGTH} characters`)
  .regex(ALIAS_PATTERN, 'Alias may only contain letters, numbers, hyphens and underscores')
  .refine(
    (value) => !RESERVED_SHORT_CODES.includes(value.toLowerCase()),
    'That alias is reserved by the application',
  );

/** Expiry must be in the future; a past date would create a dead link. */
const futureDateSchema = z.coerce
  .date()
  .refine((date) => date.getTime() > Date.now(), 'Expiry must be in the future');

export const createLinkSchema = z.object({
  url: destinationUrlSchema,
  customAlias: customAliasSchema.optional(),
  expiresAt: futureDateSchema.optional(),
});

export const updateLinkSchema = z
  .object({
    url: destinationUrlSchema.optional(),
    isActive: z.boolean().optional(),
    expiresAt: futureDateSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, 'At least one field must be provided');

export const listLinksQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  search: z.string().trim().min(1).max(200).optional(),
  isActive: z.stringbool().optional(),
});

export const registerSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  email: z.email().max(255),
  password: z.string().min(1, 'Password is required').max(128),
});

export type CreateLinkInput = z.infer<typeof createLinkSchema>;
export type UpdateLinkInput = z.infer<typeof updateLinkSchema>;
export type ListLinksQuery = z.infer<typeof listLinksQuerySchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
