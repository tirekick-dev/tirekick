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

test("draft 2020-12 meta-schema violations are errors", () => {
  const report = validateTools([
    {
      name: "old.tool",
      description: "Uses draft-04 style boolean exclusiveMinimum which 2020-12 rejects outright.",
      inputSchema: {
        type: "object",
        properties: { n: { type: "number", minimum: 0, exclusiveMinimum: true } },
      },
    },
  ]);
  assert.ok(report.findings.some((f) => f.rule === "schema-2020-12"));
});
