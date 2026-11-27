import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Module from "node:module";
import ts from "typescript";
import React from "react";
import { renderToString } from "react-dom/server";

function loadTsModule(relPath, mocks = {}) {
  const absPath = path.resolve(relPath);
  const src = fs.readFileSync(absPath, "utf-8");
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
    },
  });
  const mod = { exports: {} };
  const req = (id) => {
    if (mocks[id]) return mocks[id];
    if (id.startsWith("@/")) {
      const sub = id.slice(2);
      for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
        const cand = path.resolve("src", sub + ext);
        if (fs.existsSync(cand)) return loadTsModule(path.relative(process.cwd(), cand), mocks);
      }
    }
    return Module.createRequire(absPath)(id);
  };
  const fn = new Function("require", "module", "exports", "__filename", "__dirname", out.outputText);
  fn(req, mod, mod.exports, absPath, path.dirname(absPath));
  return mod.exports;
}

const planLib = loadTsModule("src/lib/daily-plan.ts", {
  "@/lib/db": { queryWithRetry: async () => ({ rows: [] }) },
});

assert.equal(planLib.isValidPlanDateParam(null), true);
assert.equal(planLib.isValidPlanDateParam("2026-11-23"), true);
assert.equal(planLib.isValidPlanDateParam("bad-date"), false);

const noop = () => null;
const DailyPlanView = loadTsModule("src/components/plan/DailyPlanView.tsx", {
  "next/link": { __esModule: true, default: ({ children }) => React.createElement("a", null, children) },
  "next/navigation": { __esModule: true, useRouter: () => ({ push: noop }) },
  "@/lib/patterns": { __esModule: true, detectPatterns: () => ({ patterns: [] }) },
  "@/components/shared/PageContainer": {
    __esModule: true,
    default: ({ children }) => React.createElement("div", null, children),
    SectionHeader: ({ title }) => React.createElement("h1", null, title),
  },
  "@/components/ui/card": {
    __esModule: true,
    BaseCard: ({ children }) => React.createElement("div", null, children),
  },
  "@/components/industry-strength/TopGroupsStrip": { __esModule: true, default: noop },
  "@/components/industry-strength/BottomSheet": { __esModule: true, default: noop },
  "@/components/shared/StockChartModal": { __esModule: true, default: noop },
}).default;

const html = renderToString(React.createElement(DailyPlanView));
assert.ok(typeof html === "string" && html.length > 0);
console.log("✓ DailyPlanView SSR & /api/plan date validation tests passed!");
