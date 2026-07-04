import { test } from "node:test";
import assert from "node:assert/strict";
import { validateTools } from "../dist/validate.js";

// Regression: the exact pattern that shipped in @clamp-sh/mcp <=5.5.1 and
// bricked Claude Code sessions. ECMA-valid, rejected by strict engines.
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
  assert.equal(report.grade, "D");
});

test("clean schema gets grade A", () => {
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
