/**
 * A thin wrapper around navigator.clipboard.writeText, so components depend
 * on this module rather than the global directly.
 *
 * That indirection is what makes it reliably testable: navigator.clipboard is
 * a non-configurable accessor in this project's jsdom/Vitest setup, so
 * neither Object.assign nor vi.stubGlobal can swap it out for a spy - the
 * running component keeps reading the real (jsdom-absent) implementation
 * regardless of what the test stubs on globalThis. Mocking this module
 * instead sidesteps that environment quirk entirely.
 */
export async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
}
