# tirekick

## 0.1.0

### Minor Changes

- [`013a36b`](https://github.com/clamp-sh/clamp/commit/013a36bf1083162416b77d9635cbdc92501b6056) Thanks [@sbj-o](https://github.com/sbj-o)! - `tirekick check <url> --header "Name: value"` sends request headers to auth-gated remote servers, so owners can validate servers that require credentials without those credentials ever leaving their machine.

- [`5741b43`](https://github.com/clamp-sh/clamp/commit/5741b4338f862b8a4d4e043e50b2023e7ce114a7) Thanks [@sbj-o](https://github.com/sbj-o)! - Reports now grade per category (interop, agent ergonomics, safety) from deduplicated finding counts, add an `info` severity that never moves the grade, stamp the validator version, and the CLI accepts a bare target (`npx tirekick <url>`).

- [`00ab928`](https://github.com/clamp-sh/clamp/commit/00ab92851d8d72df5335d38c92d05b4c5408e3b4) Thanks [@sbj-o](https://github.com/sbj-o)! - `fromUrl` accepts a custom `fetch`, so hosted callers can enforce an SSRF-guarded transport. The tirekick.dev checker now validates every outbound socket (MCP data plane and OAuth legs) at connect time against a net.BlockList of private/link-local/ULA/CGNAT ranges, pins DNS to defeat rebinding, blocks IPv4-mapped IPv6 and bare-IP internal targets, and refuses to follow redirects into internal addresses.

### Patch Changes

- [`feae8bd`](https://github.com/clamp-sh/clamp/commit/feae8bd5e0777fe0c29be11aba6638257bd537c0) Thanks [@sbj-o](https://github.com/sbj-o)! - Fix a false positive that graded every server emitting draft-07 (or any older $schema label) an F: the validator compiled tool schemas with an Ajv 2020 instance, which threw on the draft reference itself. The `$schema`/`$id` labels are now stripped before compiling, so draft version is irrelevant and only genuine malformation and strict-regex issues are flagged.

- [`ae57c9c`](https://github.com/clamp-sh/clamp/commit/ae57c9c0196ca323a05f33195fd9637ce9d0b52e) Thanks [@sbj-o](https://github.com/sbj-o)! - The web checker can now check auth-gated remote servers: a "Sign in & check" button runs the standard MCP OAuth flow (RFC 9728 discovery, dynamic client registration, PKCE) against the server's own identity provider. Credentials never touch tirekick; the resulting token is used for one tools/list call and discarded.

## 0.0.2

### Patch Changes

- [`b30cd3c`](https://github.com/clamp-sh/clamp/commit/b30cd3cae27a34714449344dff61d282ea809b64) Thanks [@sbj-o](https://github.com/sbj-o)! - First release cut from the monorepo: published via trusted publishing and mirrored to the public tirekick-dev/tirekick repo.
