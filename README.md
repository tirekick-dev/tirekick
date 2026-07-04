# tirekick

Kick the tires on an MCP server before you ship or install it.

An invalid tool schema doesn't fail quietly: strict API-side validation rejects the entire tools array, and every request in the client session fails until the schema is unloaded. This project exists because our own analytics MCP server shipped exactly that bug (an unescaped `[` inside a regex character class — valid ECMA, rejected by stricter engines) and bricked Claude Code sessions for weeks before anyone connected the dots.

## Usage

```
npx tirekick check https://your-server.example/mcp
npx tirekick check your-mcp-package
npx tirekick check ./tools.json
```

## Options

- `--json` — machine-readable report
- `--env KEY=VALUE` — environment for npm-package servers that need credentials to boot
- `--header "Name: value"` — request headers for auth-gated remote servers (repeatable); credentials go directly from your machine to the server under test

## What it checks

- Every input/output schema validates against JSON Schema draft 2020-12 (the bar Claude's API applies)
- Regex `pattern`s are safe for strict RE2-style engines: no lookaround, no backreferences, no unescaped `[` inside character classes
- Input schema roots are `type: "object"`
- Tool descriptions exist and are substantial enough for reliable tool selection

Exit codes: `0` clean or warnings only, `1` errors found, `2` could not check.
