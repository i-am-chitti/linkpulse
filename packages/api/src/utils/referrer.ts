/**
 * Reduces a referrer header to the host that sent the traffic.
 *
 * Full referrer URLs are high-cardinality and often carry query strings with
 * campaign or session identifiers, so storing the host keeps the "top
 * referrers" table meaningful and avoids retaining tracking parameters.
 *
 * Returns null for a missing or unparseable referrer. Null is the storage form
 * of "direct"; the label is applied when the analytics response is built, so
 * the database never guesses at presentation.
 */
export function normalizeReferrer(referrer: string | null | undefined): string | null {
  if (!referrer) return null;

  try {
    const { hostname } = new URL(referrer);
    return hostname || null;
  } catch {
    return null;
  }
}
