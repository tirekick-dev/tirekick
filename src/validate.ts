import { Ajv2020 } from "ajv/dist/2020.js";
import { VERSION } from "./version.js";

export type Severity = "error" | "warn" | "info";
export type Grade = "A" | "B" | "C" | "D" | "F";

/**
 * Every rule belongs to exactly one scoring category:
 * - `interop`: will a strict client/API reject this tool list outright?
 * - `ergonomics`: can an agent use these tools well (descriptions, schemas)?
 * - `safety`: signals that tool metadata may manipulate the agent (reserved;
 *   rules land here as they ship).
 */
export type Category = "interop" | "ergonomics" | "safety";

export const CATEGORIES: readonly Category[] = ["interop", "ergonomics", "safety"] as const;

export interface Finding {
  severity: Severity;
  category: Category;
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

export interface CategoryScore {
  grade: Grade;
  /** Distinct (tool, rule) pairs per severity — one buggy helper reused
   * across a tool's schema counts once, not once per occurrence. */
  errors: number;
  warns: number;
  infos: number;
}

export interface ToolFindingSummary {
  name: string;
  errors: number;
  warns: number;
  infos: number;
}

export interface Report {
  formatVersion: 2;
  /** Version of the validator that produced this report. */
  validator: string;
  tools: number;
  grade: Grade;
  categories: Record<Category, CategoryScore>;
  findings: Finding[];
  /** Per-tool rollup; only tools with at least one finding appear. */
  toolFindings: ToolFindingSummary[];
}

/**
 * The grade curve, published verbatim on tirekick.dev/about. Grades are
 * computed per category from deduplicated (tool, rule) units, and the
 * overall grade is the worst category grade:
 * - any error in a category caps that category at D
 * - errors touching >= `errorShareForF` of tools make it an F
 * - zero errors and zero warnings is an A
 * - warn units up to max(warnAllowanceMin, tools * warnAllowanceRatio) is a
 *   B, more is a C
 * - info findings never move a grade (new checks ship as info first)
 */
export const CURVE = {
  errorShareForF: 0.25,
  warnAllowanceMin: 2,
  warnAllowanceRatio: 0.2,
  /** Descriptions under `warnBelow` chars warn; under `infoBelow` are informational. */
  description: { warnBelow: 20, infoBelow: 40 },
  /** Tool counts above this get an informational bloat finding: every tool
   * definition is loaded into the agent's context before the first message. */
  toolCountInfoAbove: 60,
} as const;

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

/** Keys whose subtree is data, not schema: a "pattern" property inside an
 * example value is a string someone stored, not a regex a client compiles. */
const DATA_KEYS = new Set(["examples", "default", "const", "enum"]);

/** Keys whose value is a name → schema map. The child KEYS there are
 * arbitrary names — a property may legitimately be called "default" or
 * "enum" — so data-key skipping and pattern detection must not apply at
 * that level, only one level further down inside the schemas themselves. */
const NAME_MAP_KEYS = new Set(["properties", "patternProperties", "$defs", "definitions"]);

function* walkPatterns(node: unknown, path: string, inNameMap = false): Generator<[string, string]> {
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (!inNameMap) {
        if (DATA_KEYS.has(key)) continue;
        if (key === "pattern" && typeof value === "string") yield [`${path}.pattern`, value];
        // patternProperties keys are themselves regexes that strict engines
        // compile — lint them like any other pattern.
        if (key === "patternProperties" && value && typeof value === "object") {
          for (const propPattern of Object.keys(value as Record<string, unknown>)) {
            yield [`${path}.patternProperties[${JSON.stringify(propPattern)}]`, propPattern];
          }
        }
      }
      yield* walkPatterns(value, `${path}.${key}`, !inNameMap && NAME_MAP_KEYS.has(key));
    }
  }
}

const GRADE_RANK: Record<Grade, number> = { A: 0, B: 1, C: 2, D: 3, F: 4 };

function gradeCategory(findings: Finding[], toolCount: number): CategoryScore {
  const units: Record<Severity, Set<string>> = { error: new Set(), warn: new Set(), info: new Set() };
  const errorTools = new Set<string>();
  for (const f of findings) {
    units[f.severity].add(`${f.tool}\u0000${f.rule}`);
    if (f.severity === "error") errorTools.add(f.tool);
  }
  const errors = units.error.size;
  const warns = units.warn.size;
  const infos = units.info.size;

  let grade: Grade;
  if (errors > 0) {
    grade = errorTools.size / Math.max(toolCount, 1) >= CURVE.errorShareForF ? "F" : "D";
  } else if (warns === 0) {
    grade = "A";
  } else {
    grade = warns <= Math.max(CURVE.warnAllowanceMin, toolCount * CURVE.warnAllowanceRatio) ? "B" : "C";
  }
  return { grade, errors, warns, infos };
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

      // Structural validity: can this compile as a JSON Schema at all? The
      // `$schema`/`$id` keywords are STRIPPED first — a server declaring an
      // older draft (draft-07 is the ecosystem's most common choice, and
      // what the MCP TypeScript SDK's zod-to-json-schema emits) is not a
      // defect: Claude and every MCP client accept it. Compiling with the
      // draft reference intact would make Ajv-2020 throw "no schema with
      // key or ref .../draft-07/schema#" on every tool — a pure false
      // positive that failed otherwise-clean servers. What we still catch
      // here is genuine malformation (a schema no validator can compile).
      const stripped = structuredClone(schema) as Record<string, unknown>;
      delete stripped.$schema;
      delete stripped.$id;
      try {
        ajv.compile(stripped);
      } catch (e) {
        findings.push({
          severity: "error",
          category: "interop",
          tool: tool.name,
          where: field,
          rule: "schema-invalid",
          message: (e as Error).message,
        });
      }

      if (field === "inputSchema") {
        const root = schema as Record<string, unknown>;
        if (root?.type !== "object") {
          findings.push({
            severity: "error",
            category: "interop",
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
            category: "interop",
            tool: tool.name,
            where,
            rule: "strict-regex",
            message: `${JSON.stringify(pattern)}: ${issue}`,
          });
        }
      }
    }

    const description = tool.description?.trim() ?? "";
    if (description.length === 0) {
      findings.push({
        severity: "warn",
        category: "ergonomics",
        tool: tool.name,
        where: "description",
        rule: "missing-description",
        message: "tool has no description; agents pick tools by description",
      });
    } else if (description.length < CURVE.description.warnBelow) {
      findings.push({
        severity: "warn",
        category: "ergonomics",
        tool: tool.name,
        where: "description",
        rule: "thin-description",
        message: `description is ${description.length} chars; too thin for reliable tool selection`,
      });
    } else if (description.length < CURVE.description.infoBelow) {
      findings.push({
        severity: "info",
        category: "ergonomics",
        tool: tool.name,
        where: "description",
        rule: "thin-description",
        message: `description is ${description.length} chars; consider saying what the tool does and when to pick it`,
      });
    }
    if (tool.inputSchema === undefined) {
      findings.push({
        severity: "warn",
        category: "ergonomics",
        tool: tool.name,
        where: "inputSchema",
        rule: "missing-input-schema",
        message: "tool declares no input schema",
      });
    }
  }

  if (tools.length > CURVE.toolCountInfoAbove) {
    findings.push({
      severity: "info",
      category: "ergonomics",
      tool: "(server)",
      where: "tools/list",
      rule: "tool-count",
      message: `server exposes ${tools.length} tools; every definition is loaded into the agent's context, and oversized toolsets degrade tool selection`,
    });
  }

  const categories = Object.fromEntries(
    CATEGORIES.map((c) => [c, gradeCategory(findings.filter((f) => f.category === c), tools.length)]),
  ) as Record<Category, CategoryScore>;

  const grade = CATEGORIES.map((c) => categories[c].grade).reduce((worst, g) =>
    GRADE_RANK[g] > GRADE_RANK[worst] ? g : worst,
  );

  const byTool = new Map<string, ToolFindingSummary>();
  for (const f of findings) {
    const t = byTool.get(f.tool) ?? { name: f.tool, errors: 0, warns: 0, infos: 0 };
    if (f.severity === "error") t.errors++;
    else if (f.severity === "warn") t.warns++;
    else t.infos++;
    byTool.set(f.tool, t);
  }

  return {
    formatVersion: 2,
    validator: VERSION,
    tools: tools.length,
    grade,
    categories,
    findings,
    toolFindings: [...byTool.values()],
  };
}
