import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TOKENS } from "../src/lib/design-tokens.js";

function hexToRgb(hex) {
  const clean = hex.replace("#", "").trim();
  assert.equal(clean.length, 6, `Expected 6-digit hex, got ${hex}`);
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function relLuminance([r, g, b]) {
  const toLin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const [R, G, B] = [toLin(r), toLin(g), toLin(b)];
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

function contrastRatio(hexA, hexB) {
  const l1 = relLuminance(hexToRgb(hexA));
  const l2 = relLuminance(hexToRgb(hexB));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function parseCssVars(blockText) {
  const out = {};
  const re = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g;
  let m;
  while ((m = re.exec(blockText)) !== null) {
    out[m[1]] = m[2];
  }
  return out;
}

const css = fs.readFileSync(path.resolve("src/app/globals.css"), "utf-8");
const rootMatch = css.match(/:root\s*\{([\s\S]*?)\n\}/);
const darkMatch = css.match(/\.dark\s*\{([\s\S]*?)\n\}/);
assert.ok(rootMatch && darkMatch, "Both :root and .dark token blocks must exist in globals.css");

const lightVars = parseCssVars(rootMatch[1]);
const darkVars = { ...lightVars, ...parseCssVars(darkMatch[1]) };

const lightPairs = [
  ["textPrimary", TOKENS.colors.textPrimary, TOKENS.colors.bgCard, 4.5],
  ["textPrimary@bgMain", TOKENS.colors.textPrimary, TOKENS.colors.bgMain, 4.5],
  ["textSecondary@bgCard", TOKENS.colors.textSecondary, TOKENS.colors.bgCard, 4.5],
  ["textSecondary@bgMain", TOKENS.colors.textSecondary, TOKENS.colors.bgMain, 4.5],
  ["textSecondary@bgSecondary", TOKENS.colors.textSecondary, TOKENS.colors.bgSecondary, 4.5],
  ["primary@bgCard", TOKENS.colors.primary, TOKENS.colors.bgCard, 4.5],
  ["bullish@bgCard", TOKENS.colors.bullish, TOKENS.colors.bgCard, 4.5],
  ["bullish@bullishBg", TOKENS.colors.bullish, TOKENS.colors.bullishBg, 4.5],
  ["bearish@bgCard", TOKENS.colors.bearish, TOKENS.colors.bgCard, 4.5],
  ["bearish@bearishBg", TOKENS.colors.bearish, TOKENS.colors.bearishBg, 4.5],
  ["warning@bgCard", TOKENS.colors.warning, TOKENS.colors.bgCard, 4.5],
  ["warning@warningBg", TOKENS.colors.warning, TOKENS.colors.warningBg, 4.5],
];

const darkPairs = [
  ["dark:textPrimary@bgCard", darkVars["text-primary"], darkVars["bg-card"], 4.5],
  ["dark:textPrimary@bgPage", darkVars["text-primary"], darkVars["bg-page"], 4.5],
  ["dark:textSecondary@bgCard", darkVars["text-secondary"], darkVars["bg-card"], 4.5],
  ["dark:textSecondary@bgPage", darkVars["text-secondary"], darkVars["bg-page"], 4.5],
  ["dark:textSecondary@bgSecondary", darkVars["text-secondary"], darkVars["bg-secondary"], 4.5],
  ["dark:bullish@bgCard", "#34D399", darkVars["bg-card"], 4.5],
  ["dark:bearish@bgCard", "#FB7185", darkVars["bg-card"], 4.5],
];

const report = [];
for (const [name, fg, bg, minRatio] of [...lightPairs, ...darkPairs]) {
  const ratio = contrastRatio(fg, bg);
  report.push(`${name}: ${ratio.toFixed(2)}:1 (${fg} on ${bg})`);
  assert.ok(
    ratio >= minRatio,
    `Contrast failure for ${name}: ${ratio.toFixed(2)}:1 < ${minRatio}:1 (${fg} on ${bg})`
  );
}

console.log("✓ Token WCAG AA contrast checks passed:");
for (const line of report) console.log(`  - ${line}`);
