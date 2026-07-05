# tirekick

Kick the tires on an MCP server before you ship or install it.

An invalid tool schema doesn't fail quietly: strict API-side validation rejects the entire tools array, and every request in the client session fails until the schema is unloaded. This project exists because our own analytics MCP server shipped exactly that bug (an unescaped `[` inside a regex character class — valid ECMA, rejected by stricter engines) and bricked Claude Code sessions for weeks before anyone connected the dots.

The hosted checker and a graded directory of the public MCP registry live at [tirekick.dev](https://tirekick.dev).

## Usage

```
npx tirekick https://your-server.example/mcp
npx tirekick your-mcp-package
npx tirekick ./tools.json
```

(`tirekick check <target>` is the same command, spelled out.)

## Options

- `--json` — machine-readable report
- `--env KEY=VALUE` — environment for npm-package servers that need credentials to boot
- `--header "Name: value"` — request headers for auth-gated remote servers (repeatable); credentials go directly from your machine to the server under test

## What it checks

Findings carry a severity (`error` / `warn` / `info`) and a category (`interop` / `ergonomics` / `safety`); the report grades each category and overall, A through F:

- Every input/output schema validates against JSON Schema draft 2020-12 (the bar Claude's API applies) — error
- Regex `pattern`s are safe for strict RE2-style engines: no lookaround, no backreferences, no unescaped `[` inside character classes — error
- Input schema roots are `type: "object"` — error
- Tool descriptions exist and are substantial enough for reliable tool selection — warn under 20 chars, info under 40

Grading dedupes findings to distinct (tool, rule) pairs: any error caps a category at D, errors touching ≥25% of tools grade F, and info findings never move the grade. The full rubric: [tirekick.dev/about](https://tirekick.dev/about#grading).

## CI

The exit code is the contract: `0` clean or warnings only, `1` errors found, `2` could not check. `npx tirekick <url-or-package>` in a workflow fails the build when a strict client would reject your server.
