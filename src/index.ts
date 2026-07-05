#!/usr/bin/env node
import { fromFile, fromNpm, fromUrl, type ConnectResult } from "./connect.js";
import { validateTools, CATEGORIES, type Report } from "./validate.js";

const USAGE = `tirekick — kick the tires on an MCP server before you ship or install it

Usage:
  tirekick <target> [--json] [--env KEY=VALUE ...] [--header "Name: value" ...]
  tirekick check <target> [...]     same thing, spelled out

Targets:
  https://host/mcp        remote server (streamable HTTP)
  some-package            npm package, run via npx over stdio
  ./tools.json            a saved tools/list response or tools array

Auth-gated remotes: pass your own credentials with --header; they go
directly from your machine to that server and nowhere else:
  tirekick https://host/mcp --header "Authorization: Bearer <token>"

Checks (graded per category — interop, agent ergonomics, safety):
  - every input/output schema validates against JSON Schema draft 2020-12
  - regex patterns are safe for strict engines (no lookaround, backrefs,
    or unescaped '[' in character classes — the stuff that gets a whole
    tools array rejected by API-side validation)
  - tool descriptions exist and are substantial enough for tool selection

Exit codes: 0 clean or warnings only, 1 errors found, 2 could not check.`;

function pickTarget(target: string) {
  if (/^https?:\/\//.test(target)) return "url" as const;
  if (/\.json$/i.test(target) || target.startsWith("./") || target.startsWith("/")) return "file" as const;
  return "npm" as const;
}

const SEVERITY_MARK = { error: "✖", warn: "▲", info: "·" } as const;

function render(report: Report, source: string): string {
  const lines: string[] = [];
  const errors = report.findings.filter((f) => f.severity === "error");
  const warns = report.findings.filter((f) => f.severity === "warn");
  lines.push(`tirekick report — ${source}`);
  lines.push(`tools: ${report.tools}   errors: ${errors.length}   warnings: ${warns.length}   grade: ${report.grade}`);
  lines.push(CATEGORIES.map((c) => `${c}: ${report.categories[c].grade}`).join("   "));
  for (const f of report.findings) {
    lines.push(`  ${SEVERITY_MARK[f.severity]} [${f.rule}] ${f.tool} → ${f.where}`);
    lines.push(`     ${f.message.split("\n")[0]}`);
  }
  if (report.findings.length === 0) lines.push("  ✓ no findings — schemas are clean");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  // `tirekick <target>` and `tirekick check <target>` are the same command.
  if (args[0] === "check") args.shift();
  const target = args[0];
  if (!target || target.startsWith("-") || args.includes("--help")) {
    console.log(USAGE);
    process.exit(args.includes("--help") ? 0 : 2);
  }
  const asJson = args.includes("--json");
  const env: Record<string, string> = {};
  const headers: Record<string, string> = {};
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]?.includes("=")) {
      const [k, ...rest] = args[++i].split("=");
      env[k] = rest.join("=");
    } else if (args[i] === "--header" && args[i + 1]?.includes(":")) {
      const [name, ...rest] = args[++i].split(":");
      headers[name.trim()] = rest.join(":").trim();
    }
  }

  const kind = pickTarget(target);
  const result: ConnectResult =
    kind === "url"
      ? await fromUrl(target, { headers: Object.keys(headers).length ? headers : undefined })
      : kind === "file"
        ? await fromFile(target)
        : await fromNpm(target, env);

  if (!result.tools) {
    if (result.authGated) {
      console.error(
        `Could not scan ${target}: the server requires credentials before listing tools.\n` +
          `Remote servers: pass your own token with --header "Authorization: Bearer <token>".\n` +
          `npm servers: pass credentials with --env KEY=VALUE.` +
          (result.bootError ? `\n\n${result.bootError}` : ""),
      );
    } else {
      console.error(`Could not check ${target}: ${result.bootError}`);
    }
    process.exit(2);
  }

  const report = validateTools(result.tools);
  if (asJson) {
    console.log(JSON.stringify({ source: target, ...report }, null, 2));
  } else {
    console.log(render(report, target));
  }
  process.exit(report.findings.some((f) => f.severity === "error") ? 1 : 0);
}

main().catch((e) => {
  console.error(`tirekick crashed: ${(e as Error).stack ?? e}`);
  process.exit(2);
});
