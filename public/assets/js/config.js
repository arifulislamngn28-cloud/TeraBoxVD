/**
 * Runtime configuration for the static build.
 *
 * The site can be hosted in two ways:
 *   1. Behind the teraboxvd Node server  → leave apiBase empty (same origin).
 *   2. As a static site on any CDN/host  → set apiBase to your backend URL.
 *
 * The user can always override this at runtime from the UI (stored in
 * localStorage), so a static deployment is never locked to one backend.
 */
window.TBVD_CONFIG = {
  // e.g. 'https://teraboxvd.onrender.com' — empty means "same origin".
  apiBase: '',
};
