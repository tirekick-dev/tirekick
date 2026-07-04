#!/usr/bin/env node
import { fromFile, fromNpm, fromUrl, type ConnectResult } from "./connect.js";
import { validateTools, type Report } from "./validate.js";

const USAGE = `tirekick — kick the tires on an MCP server before you ship or install it

Usage:
  tirekick check <target> [--json] [--env KEY=VALUE ...]

Targets:
  https://host/mcp        remote server (streamable HTTP)
  some-package            npm package, run via npx over stdio
  ./tools.json            a saved tools/list response or tools array

Checks:
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

function render(report: Report, source: string): string {
  const lines: string[] = [];
  const errors = report.findings.filter((f) => f.severity === "error");
  const warns = report.findings.filter((f) => f.severity === "warn");
  lines.push(`tirekick report — ${source}`);
  lines.push(`tools: ${report.tools}   errors: ${errors.length}   warnings: ${warns.length}   grade: ${report.grade}`);
  for (const f of report.findings) {
    lines.push(`  ${f.severity === "error" ? "✖" : "▲"} [${f.rule}] ${f.tool} → ${f.where}`);
    lines.push(`     ${f.message.split("\n")[0]}`);
  }
  if (report.findings.length === 0) lines.push("  ✓ no findings — schemas are clean");
  return lines.join("\n");
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== "check" || !args[1] || args.includes("--help")) {
    console.log(USAGE);
    process.exit(args.includes("--help") ? 0 : 2);
  }
  const target = args[1];
  const asJson = args.includes("--json");
  const env: Record<string, string> = {};
  for (let i = 2; i < args.length; i++) {
    if (args[i] === "--env" && args[i + 1]?.includes("=")) {
      const [k, ...rest] = args[++i].split("=");
      env[k] = rest.join("=");
    }
  }

  const kind = pickTarget(target);
  const result: ConnectResult =
    kind === "url" ? await fromUrl(target) : kind === "file" ? await fromFile(target) : await fromNpm(target, env);

  if (!result.tools) {
    if (result.authGated) {
      console.error(
        `Could not scan ${target}: the server requires credentials before listing tools.\n` +
          `For npm servers, pass them with --env KEY=VALUE. For OAuth remotes, scan is not yet supported.` +
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
