# Studio project JSON transport

Large saved projects retain their complete story, source analysis, placements and
identity evidence. They are compressed for transport rather than stripped to fit
the hosting payload cap. Vercel documents a 4.5 MB cap for both request and response
bodies: [Functions limits](https://vercel.com/docs/functions/limitations).

The browser project/draft client compresses JSON above 64 KiB with
`CompressionStream("gzip")`, sends `Content-Encoding: gzip`, and negotiates compressed
responses with `X-Studio-Json-Transport: gzip`. Browsers decode response
`Content-Encoding: gzip` before the existing JSON readers run. Small raw JSON
callers remain compatible. Server-side compressed request support does not depend
on the browser implementation; direct HTTP clients can send the same headers and
gzip bytes. Compressed responses use private/no-store caching and vary on the
transport negotiation header.

Every save route authenticates before accessing the request body. Streamed input
is capped at 4,000,000 bytes and inflated JSON at 32 MiB. Node's
[`gunzip` output bound](https://nodejs.org/api/zlib.html#class-options) prevents a
small compressed body expanding without limit. Malformed JSON, UTF-8, unsupported
encoding or invalid gzip returns 400; oversized wire/expanded bodies return 413.
Existing draft-shape and owner-scoped storage validation still applies. Large
responses require negotiation and obey the same bounds. No credentials or
client-supplied storage paths are added to this protocol.

After a successful durable save/load, the browser's local-storage mirror is best
effort. Quota exhaustion does not report a failed cloud save, and a stale draft
mirror is removed if it cannot be replaced. The active project pointer remains
small; server storage remains authoritative for the named project.

The transport tests cover large 21-source creation/save/reload, preservation of
13 placements and the full story, raw JSON compatibility, malformed and oversized
input, bounded gzip expansion, anonymous requests before body access, pointer
cookies, client compression and exhausted browser cache quotas. Production
browser save/reload is a separate deployment acceptance gate.
