import { Ajv2020 } from "ajv/dist/2020.js";

export type Severity = "error" | "warn";

export interface Finding {
  severity: Severity;
  tool: string;
  where: string;
  rule: string;
  message: string;
}

export interface ToolShape {
  name: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface Report {
  tools: number;
  findings: Finding[];
  grade: "A" | "B" | "C" | "D" | "F";
}

/**
 * Regex constructs that are valid ECMA-262 but rejected by the stricter
 * RE2/Rust-style engines several API-side validators use. Shipping one of
 * these in a `pattern` can get the entire tools array rejected — every
 * request in the client session fails until the schema is unloaded. (This
 * is the exact failure mode that bricked Claude Code sessions for
 * @clamp-sh/mcp <=5.5.1: an unescaped `[` inside a character class.)
 */
function lintPattern(pattern: string): string[] {
  const issues: string[] = [];
  if (/\(\?<?[=!]/.test(pattern)) issues.push("lookaround ((?=, (?!, (?<=, (?<!) is not RE2-compatible");
  if (/\\[1-9]/.test(pattern)) issues.push("backreference (\\1-\\9) is not RE2-compatible");
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (!inClass && c === "[") {
      inClass = true;
      continue;
    }
    if (inClass && c === "[") issues.push("unescaped '[' inside a character class breaks strict regex engines — escape it as \\[");
    if (inClass && c === "]") inClass = false;
  }
  try {
    new RegExp(pattern);
  } catch (e) {
    issues.push(`not a valid ECMA regex: ${(e as Error).message}`);
  }
  return [...new Set(issues)];
}

function* walkPatterns(node: unknown, path: string): Generator<[string, string]> {
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === "pattern" && typeof value === "string") yield [`${path}.pattern`, value];
      yield* walkPatterns(value, `${path}.${key}`);
    }
  }
}

export function validateTools(tools: ToolShape[]): Report {
  const findings: Finding[] = [];
  const ajv = new Ajv2020({ strict: false });

  for (const tool of tools) {
    for (const [field, schema] of [
      ["inputSchema", tool.inputSchema],
      ["outputSchema", tool.outputSchema],
    ] as const) {
      if (schema === undefined) continue;

      // Draft 2020-12 conformance: ajv validates the schema against the
      // meta-schema at compile time, which is the same bar the Claude API
      // applies to input_schema.
      try {
        ajv.compile(structuredClone(schema) as object);
      } catch (e) {
        findings.push({
          severity: "error",
          tool: tool.name,
          where: field,
          rule: "schema-2020-12",
          message: (e as Error).message,
        });
      }

      if (field === "inputSchema") {
        const root = schema as Record<string, unknown>;
        if (root?.type !== "object") {
          findings.push({
            severity: "error",
            tool: tool.name,
            where: field,
            rule: "root-type-object",
            message: `input schema root must be type "object" (got ${JSON.stringify(root?.type)})`,
          });
        }
      }

      for (const [where, pattern] of walkPatterns(schema, field)) {
        for (const issue of lintPattern(pattern)) {
          findings.push({
            severity: "error",
            tool: tool.name,
            where,
            rule: "strict-regex",
            message: `${JSON.stringify(pattern)}: ${issue}`,
          });
        }
      }
    }

    if (!tool.description || tool.description.trim().length === 0) {
      findings.push({
        severity: "warn",
        tool: tool.name,
        where: "description",
        rule: "missing-description",
        message: "tool has no description; agents pick tools by description",
      });
    } else if (tool.description.trim().length < 40) {
      findings.push({
        severity: "warn",
        tool: tool.name,
        where: "description",
        rule: "thin-description",
        message: `description is ${tool.description.trim().length} chars; too thin for reliable tool selection`,
      });
    }
    if (tool.inputSchema === undefined) {
      findings.push({
        severity: "warn",
        tool: tool.name,
        where: "inputSchema",
        rule: "missing-input-schema",
        message: "tool declares no input schema",
      });
    }
  }

  const errors = findings.filter((f) => f.severity === "error").length;
  const warns = findings.filter((f) => f.severity === "warn").length;
  const grade = errors > 0 ? (errors >= 3 ? "F" : "D") : warns === 0 ? "A" : warns <= Math.max(2, tools.length * 0.2) ? "B" : "C";

  return { tools: tools.length, findings, grade };
}
