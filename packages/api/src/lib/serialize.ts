import type { LinkDto } from '@linkpulse/shared';
import { env } from '../config/env.js';
import type { Link } from '../generated/prisma/client.js';

/**
 * Maps a database row to the API shape.
 *
 * shortUrl is composed here rather than stored, so moving the service to a new
 * domain does not require rewriting every row.
 */
export function toLinkDto(link: Link): LinkDto {
  return {
    id: link.id,
    shortCode: link.shortCode,
    shortUrl: new URL(link.shortCode, env.APP_BASE_URL).toString(),
    originalUrl: link.originalUrl,
    isActive: link.isActive,
    expiresAt: link.expiresAt?.toISOString() ?? null,
    clickCount: link.clickCount,
    createdAt: link.createdAt.toISOString(),
    updatedAt: link.updatedAt.toISOString(),
  };
}
