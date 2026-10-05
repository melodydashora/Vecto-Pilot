# Root public directory

Vite builds static web assets from [client/public](../client/public), using the
client root configured in [vite.config.js](../vite.config.js). The gateway serves
`client/dist`; the canonical robots input is
[client/public/robots.txt](../client/public/robots.txt).

The duplicate root robots file was removed on October 4, 2026. The former guide
incorrectly claimed the gateway served this whole root directory. The
[make-jwks utility](../scripts/make-jwks.mjs) still writes
`public/.well-known/jwks.json`; that write alone does not establish a public
serving route. Preserve that tooling boundary when changing static assets.

Original documentation and duplicate bytes are retained in the external Astra
cleanup archive and the `b4bba633` Git tree.
