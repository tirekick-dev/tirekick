import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTools } from "../dist/validate.js";

/** A clean, well-described tool for padding out multi-tool servers. */
function cleanTool(name) {
  return {
    name,
    description: `The ${name} tool returns a well-documented result for a specific, clearly scoped question.`,
    inputSchema: { type: "object", properties: { period: { type: "string" } } },
  };
}

// Regression: the exact pattern that shipped in @clamp-sh/mcp <=5.5.1 and
// bricked Claude Code sessions. ECMA-valid, rejected by strict engines.
// A single-tool server whose only tool is broken is broken outright: the
// error share (100%) is past the F threshold.
test("flags unescaped '[' inside a character class", () => {
  const report = validateTools([
    {
      name: "funnels.create",
      description: "Create and immediately evaluate a conversion funnel with ordered steps.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", pattern: "^[^/,[\\]]+$" } },
      },
    },
  ]);
  assert.equal(report.findings.filter((f) => f.rule === "strict-regex").length, 1);
  assert.equal(report.grade, "F");
});

test("clean schema gets grade A with A in every category", () => {
  const report = validateTools([
    {
      name: "traffic.overview",
      description: "High-level snapshot of website traffic over a period with comparison to the prior window.",
      inputSchema: {
        type: "object",
        properties: { period: { type: "string", pattern: "^[0-9]+d$" } },
      },
    },
  ]);
  assert.equal(report.findings.length, 0);
  assert.equal(report.grade, "A");
  assert.equal(report.formatVersion, 2);
  assert.ok(report.validator.length > 0);
  for (const category of ["interop", "ergonomics", "safety"]) {
    assert.equal(report.categories[category].grade, "A");
  }
});

test("rejects lookahead and non-object roots", () => {
  const report = validateTools([
    {
      name: "bad.tool",
      description: "A deliberately broken tool used to exercise the validator's error paths.",
      inputSchema: {
        type: "array",
        items: { type: "string", pattern: "^(?=.*x).*$" },
      },
    },
  ]);
  const rules = report.findings.map((f) => f.rule).sort();
  assert.deepEqual(rules, ["root-type-object", "strict-regex"]);
  assert.ok(report.findings.every((f) => f.category === "interop"));
});

test("genuinely malformed schemas are errors", () => {
  const report = validateTools([
    {
      name: "old.tool",
      description: "Uses draft-04 style boolean exclusiveMinimum which strict clients reject outright.",
      inputSchema: {
        type: "object",
        properties: { n: { type: "number", minimum: 0, exclusiveMinimum: true } },
      },
    },
  ]);
  assert.ok(report.findings.some((f) => f.rule === "schema-invalid"));
});

// Regression: a server declaring an older draft ($schema: draft-07) with
// otherwise-clean schemas must grade A. The draft label alone previously
// threw "no schema with key or ref .../draft-07/schema#" per tool and
// forced an F on the whole server (e.g. Clamp's own MCP, and much of the
// ecosystem, which emit draft-07).
test("draft-07 $schema label is not a defect", () => {
  const report = validateTools([
    {
      name: "traffic.overview",
      description: "High-level snapshot of website traffic over a period with a comparison block.",
      inputSchema: {
        $schema: "http://json-schema.org/draft-07/schema#",
        type: "object",
        properties: { period: { type: "string" }, project_id: { type: "string" } },
      },
    },
  ]);
  assert.equal(report.findings.length, 0);
  assert.equal(report.grade, "A");
});

// Curve: correlated findings must not stack. One tool with three bad
// patterns under the same rule is one (tool, rule) unit — a D on a server
// where it is 1 of 5 tools (20% error share, under the 25% F threshold),
// not an F from raw finding count.
test("correlated errors dedupe to one unit per (tool, rule)", () => {
  const report = validateTools([
    {
      name: "search.products",
      description: "Search the product catalog by name, category, or free-text query with pagination.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "string", pattern: "^(?=x)" },
          b: { type: "string", pattern: "^(?=y)" },
          c: { type: "string", pattern: "^(?=z)" },
        },
      },
    },
    cleanTool("orders.list"),
    cleanTool("orders.get"),
    cleanTool("customers.list"),
    cleanTool("customers.get"),
  ]);
  assert.equal(report.categories.interop.errors, 1);
  assert.equal(report.grade, "D");
});

// Curve: errors touching >= 25% of tools grade F, not D.
test("widespread errors grade F by share of tools affected", () => {
  const report = validateTools([
    {
      name: "one.broken",
      description: "A broken tool that pushes the error share across the F threshold on a small server.",
      inputSchema: { type: "array" },
    },
    cleanTool("two.clean"),
  ]);
  assert.equal(report.grade, "F");
});

// Severity rebalance: 20-39 char descriptions are informational, not
// warnings, and info findings never move the grade.
test("short-but-present descriptions are info and do not move the grade", () => {
  const report = validateTools([
    {
      name: "ping",
      description: "Check server liveness.", // 22 chars: info tier
      inputSchema: { type: "object", properties: {} },
    },
  ]);
  const finding = report.findings.find((f) => f.rule === "thin-description");
  assert.equal(finding?.severity, "info");
  assert.equal(report.grade, "A");
  assert.equal(report.categories.ergonomics.infos, 1);
});

test("sub-20-char descriptions still warn", () => {
  const report = validateTools([
    {
      name: "ping",
      description: "Pings.", // 6 chars: warn tier
      inputSchema: { type: "object", properties: {} },
    },
  ]);
  const finding = report.findings.find((f) => f.rule === "thin-description");
  assert.equal(finding?.severity, "warn");
  assert.equal(report.grade, "B");
});

// walkPatterns false-positive fix: a "pattern" key inside examples/default/
// const/enum is data someone stored, not a regex a client compiles.
test("pattern strings in data positions are not linted", () => {
  const report = validateTools([
    {
      name: "rules.save",
      description: "Persist a matching rule configuration object for later evaluation against events.",
      inputSchema: {
        type: "object",
        properties: {
          rule: {
            type: "object",
            default: { pattern: "an [unescaped bracket that is data" },
            examples: [{ pattern: "(?=lookahead-as-data)" }],
          },
        },
      },
    },
  ]);
  assert.equal(report.findings.filter((f) => f.rule === "strict-regex").length, 0);
  assert.equal(report.grade, "A");
});

// A property literally NAMED "default"/"enum"/"examples"/"const" is a name,
// not a data position — its schema subtree must still be linted.
test("properties named after data keywords are still linted", () => {
  const report = validateTools([
    {
      name: "config.save",
      description: "Persist a configuration object with sensible fallbacks for optional settings.",
      inputSchema: {
        type: "object",
        properties: {
          default: { type: "string", pattern: "^(?=x).*$" },
          enum: { type: "string", pattern: "^(?=y).*$" },
        },
      },
    },
  ]);
  assert.equal(report.findings.filter((f) => f.rule === "strict-regex").length, 2);
});

// A property literally named "pattern" holds a schema, not a regex.
test("a property named pattern is not linted as a regex", () => {
  const report = validateTools([
    {
      name: "regex.tool",
      description: "Accepts a pattern configuration object for later server-side matching logic.",
      inputSchema: {
        type: "object",
        properties: { pattern: { type: "string" } },
      },
    },
  ]);
  assert.equal(report.findings.filter((f) => f.rule === "strict-regex").length, 0);
});

// patternProperties KEYS are regexes strict engines compile.
test("patternProperties keys are linted as regexes", () => {
  const report = validateTools([
    {
      name: "dyn.tool",
      description: "Accepts dynamic keys validated against a keyed pattern in the schema.",
      inputSchema: {
        type: "object",
        patternProperties: { "^(?=bad)": { type: "string" } },
      },
    },
  ]);
  assert.equal(report.findings.filter((f) => f.rule === "strict-regex").length, 1);
});

// Tool-count bloat is informational: visible, never grade-moving.
test("oversized toolsets get an info finding that doesn't move the grade", () => {
  const tools = Array.from({ length: 61 }, (_, i) => cleanTool(`tool.${i}`));
  const report = validateTools(tools);
  const finding = report.findings.find((f) => f.rule === "tool-count");
  assert.equal(finding?.severity, "info");
  assert.equal(report.grade, "A");
});

test("toolFindings rolls up per tool, only tools with findings", () => {
  const report = validateTools([
    {
      name: "bad.tool",
      description: "A deliberately broken tool used to exercise the per-tool rollup in reports.",
      inputSchema: { type: "array" },
    },
    cleanTool("clean.tool"),
  ]);
  assert.equal(report.toolFindings.length, 1);
  assert.equal(report.toolFindings[0].name, "bad.tool");
  assert.equal(report.toolFindings[0].errors, 1);
});
