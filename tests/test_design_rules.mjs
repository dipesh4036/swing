import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/**
 * Explicit, audited allowlists for Z1.4 design-system enforcement.
 * Every entry has a documented reason.
 */
export const ALLOWLIST = {
  // JetBrains Mono is allowed ONLY for raw code/ticker/terminal badges or chart axis ticks
  fontMono: new Map([
    ["src/app/globals.css", "Defines --font-mono CSS variable"],
    ["src/app/layout.tsx", "Loads JetBrains Mono Next font variable"],
    ["src/components/charts/PatternDetailPanel.jsx", "Raw OHLC/pivot coordinate readout"],
    ["src/components/charts/PatternLayersBar.jsx", "Chart overlay coordinate counters"],
    ["src/components/industry-strength/StockDetailPanel.jsx", "Stock ticker symbol badge"],
  ]),
  // < 12px text allowed ONLY for chart axis ticks, "as of" timestamps, or chart overlay micro-badges
  sub12px: new Map([
    ["src/components/charts/BaseAreaChart.jsx", "Chart axis tick labels (11px)"],
    ["src/components/charts/DivergingBarChart.jsx", "Chart axis tick labels (11px)"],
    ["src/components/charts/ComparisonChart.jsx", "Chart axis tick labels (11px)"],
    ["src/components/charts/PatternLayersBar.jsx", "Chart overlay micro-badges"],
    ["src/components/charts/PatternDetailPanel.jsx", "Chart overlay coordinate metadata (11px)"],
    ["src/components/industry-strength/TopGroupsStrip.tsx", "As-of timestamp (11px)"],
  ]),
  // Raw hex colors / inline style={{ color }} allowed ONLY in chart canvas/SVG theme adapters and icons
  rawColor: new Map([
    ["src/app/globals.css", "CSS variable token definitions"],
    ["src/app/icon.svg", "Static favicon SVG"],
    ["src/components/charts/BaseAreaChart.jsx", "Lightweight-charts / SVG canvas series colors"],
    ["src/components/charts/ComparisonChart.jsx", "Lightweight-charts / SVG canvas series colors"],
    ["src/components/charts/DivergingBarChart.jsx", "SVG bar series colors"],
    ["src/components/charts/SparklineChart.jsx", "SVG sparkline stroke colors"],
    ["src/components/charts/patternLayers.js", "Canvas 2D pattern trendline & marker renderer"],
    ["src/components/screener/ScreenerChart.jsx", "Lightweight-charts canvas series & marker colors"],
    ["src/components/screener/ScreenerGrid.jsx", "Mini chart series & marker colors"],
    ["src/components/industry-strength/RotationChart.tsx", "Multi-series SVG/chart line palette"],
    ["src/components/industry-strength/StockDetailPanel.jsx", "Lightweight-charts canvas theme & EMA line colors"],
    ["src/components/shared/StockChartModal.tsx", "Lightweight-charts canvas theme, volume & SMA series colors"],
    ["src/components/market-breadth/LargeMidSmall.js", "Cap-series chart line palette (Large/Mid/Small)"],
    ["src/components/market-breadth/ParticipationHistory.js", "Participation chart series palette"],
    ["src/components/market-breadth/StageComparisonChart.js", "Weinstein stage chart series palette"],
  ]),
  // text-text-muted allowed ONLY for decorative icons, empty-dash placeholders, or disabled controls
  textMuted: new Map([
    ["src/components/shared/PageContainer.tsx", "Decorative tooltip icon"],
    ["src/components/layout/Sidebar.jsx", "Disabled/inactive nav icon"],
  ]),
};

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(js|jsx|ts|tsx|css)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const files = [...walk("src/components"), ...walk("src/app")];
const violations = [];

for (const abs of files) {
  const rel = path.relative(process.cwd(), abs).replace(/\\/g, "/");
  const lines = fs.readFileSync(abs, "utf-8").split("\n");

  lines.forEach((line, idx) => {
    const ln = idx + 1;

    if (/\bfont-mono\b/.test(line) && !ALLOWLIST.fontMono.has(rel)) {
      violations.push(`${rel}:${ln} [font-mono]: ${line.trim()}`);
    }

    const pxMatches = [...line.matchAll(/text-\[(\d+)px\]/g)];
    for (const m of pxMatches) {
      if (Number(m[1]) < 12 && !ALLOWLIST.sub12px.has(rel)) {
        violations.push(`${rel}:${ln} [text-[${m[1]}px] < 12px]: ${line.trim()}`);
      }
    }

    const lineWithoutCssVarFallback = line.replace(/var\(--[^)]+\)/g, "");
    if (/(?:#[0-9a-fA-F]{3,8}\b|style=\{\{[^}]*\bcolor\s*:)/.test(lineWithoutCssVarFallback) && !ALLOWLIST.rawColor.has(rel)) {
      violations.push(`${rel}:${ln} [raw color/hex]: ${line.trim()}`);
    }

    // Check text-text-muted or text-text-faint on informational text (allow only placeholder/icon/dash lines)
    if (/\btext-text-(?:muted|faint)\b/.test(line) && !ALLOWLIST.textMuted.has(rel)) {
      const isIconOrPlaceholder =
        /placeholder:|pointer-events-none|aria-hidden|disabled:|className="w-\d|—<\/span>/.test(line);
      if (!isIconOrPlaceholder) {
        violations.push(`${rel}:${ln} [text-text-muted]: ${line.trim()}`);
      }
    }
  });
}

if (violations.length > 0) {
  console.error(`Design rule violations (${violations.length}):`);
  for (const v of violations.slice(0, 60)) console.error(`  - ${v}`);
  assert.fail(`Found ${violations.length} design-system rule violation(s).`);
}

console.log(`✓ Design-system rules check passed (${files.length} files scanned, 0 violations).`);
