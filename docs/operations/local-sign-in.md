# Local GitHub sign-in

Local pages and OAuth callbacks must use the same browser hostname. Auth.js uses host-only state, PKCE, and session cookies; a cookie set on `127.0.0.1` is not sent to `localhost`.

The installed Next.js 16.2.1 `NextURL` normalizes loopback request URLs to `localhost`. With Auth.js 5.0.0-beta.31, this can advertise a `localhost` GitHub callback even when the browser started on `127.0.0.1` and neither `AUTH_URL` nor `NEXTAUTH_URL` is configured. The browser then returns without the verifier cookie.

`next.config.ts` now redirects the alternate loopback hostname before page rendering or any sign-in endpoint sets cookies:

- An explicit local `AUTH_URL` or `NEXTAUTH_URL` chooses the canonical host in either direction: `localhost` or `127.0.0.1`.
- Without either URL, development uses `http://localhost:<PORT>`; the default development port is 3000.
- Hosted origins and production without an explicit URL retain their existing request-inferred routing. Post-login redirects still reject foreign origins.

These are temporary 307 redirects, preserving paths, query parameters, and HTTP methods. This change does not alter provider registration, credentials, session configuration, cookie protections, or required route authentication.

After loading the updated Next config, start a fresh sign-in from the app's canonical local URL. An OAuth authorization page opened before canonicalization may represent an already broken cookie flow. Verification requires an actual GitHub browser click-through, a successful `/api/auth/session`, and authenticated project access on the same origin. Synthetic JWT harness checks bypass OAuth and do not satisfy that gate.

The focused auth tests exercise both hostname directions, unset-URL development, canonical-host stability, query/path retention, production behavior, and foreign-host rejection. Next's bundled experimental config-response tester omits external destination ports in its reconstructed response, so tests check the rule's port separately; inspect the real browser/network Location header for final verification.

See [Auth.js deployment](https://authjs.dev/getting-started/deployment) for provider callback configuration. Existing registration and runtime authentication variables remain the operator-controlled source of truth.
