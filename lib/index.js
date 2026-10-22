/**
 * dsh-popup — Host face.
 *
 * The whole feature is a browser-side concern: the popup reads a text
 * selection, and writes into the composer through the Client's own input
 * face. This module exists so the Loader has a real Host entry to mount for
 * the `dsh-popup` row in `cordis.patch.yml`; the mounted row is what
 * makes the Client bundle part of the boot graph.
 */

/** Loader-facing plugin name. Must equal the package name (see lib/client.js). */
export const name = 'dsh-popup'

/** No Host services are required. */
export const inject = []

/**
 * Host activation. Intentionally empty: the plugin contributes no Host
 * capability and must not touch the Host beyond being mounted.
 */
export function apply() {}
