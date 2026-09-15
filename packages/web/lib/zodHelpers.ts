/**
 * Zod preprocess helper: an untouched optional HTML input submits "", not
 * undefined, and an optional schema's own rules (min-length, etc.) reject ""
 * the same way they reject any too-short value - so a blank optional field
 * reads as invalid input rather than as "not provided" unless this runs
 * first. Use via `z.preprocess(emptyToUndefined, someOptionalSchema)`.
 */
export function emptyToUndefined(value: unknown) {
  return value === '' ? undefined : value;
}
