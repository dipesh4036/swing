# Unified Institutional Design System

A centralized, production-grade design system for the Indian Equities Momentum & Market Breadth platform.

---

## 1. Design Philosophy

- **Institutional Clarity:** Clean, information-dense, high-precision financial analytics.
- **Single Source of Truth:** Centralized design tokens in `src/lib/design-tokens.js` and CSS variables in `src/app/globals.css`.
- **Dual Theme (Light & Dark):** Cool Zinc & Electric Indigo across both Light (`#FAFAFA` / `#FFFFFF`) and Dark (`#09090B` / `#18181B`) canvases, toggled via `ThemeToggle`.
- **WCAG 2.1 AA Contrast & Minimum Type:** Enforced automatically by `tests/test_tokens_contrast.mjs` (`>= 4.5:1`) and `tests/test_design_rules.mjs` (`>= 12px` informational text, Inter + `tabular-nums`).

---

## 2. Centralized Color Palette & Verified Contrast

| Token | Light | Dark | Light Contrast (vs Card) | Dark Contrast (vs Card) | Semantic Usage |
|-------|-------|------|--------------------------|-------------------------|----------------|
| `textPrimary` | `#18181B` | `#FAFAFA` | `17.72:1` | `16.97:1` | Headings, metrics, group/stock names |
| `textSecondary` | `#52525B` | `#A1A1AA` | `7.73:1` | `6.91:1` | Subtitles, labels, breadcrumbs, notes |
| `textMuted` | `#71717A` | `#71717A` | Decorative/disabled only | Decorative/disabled only | Placeholders, disabled controls, decorative icons |
| `primary` | `#4F46E5` | `#6366F1` | `6.29:1` | — | Active tabs, primary buttons, links |
| `bgPage` / `bgCard` | `#FAFAFA` / `#FFFFFF` | `#09090B` / `#18181B` | — | — | Page canvas / card surface |
| `bgSecondary` | `#F4F4F5` | `#121215` | `7.03:1` (`textSecondary`) | `7.30:1` (`textSecondary`) | Table headers, chips, subtle panels |
| `bullish` / `bullishBg` | `#047857` / `#ECFDF5` | `#34D399` / `#064E3B` | `5.48:1` (`5.21:1` on bg) | `9.22:1` | Positive returns, advancing breadth |
| `bearish` / `bearishBg` | `#BE123C` / `#FFF1F2` | `#FB7185` / `#4C0519` | `6.29:1` (`5.72:1` on bg) | `6.58:1` | Negative returns, declining breadth |
| `warning` / `warningBg` | `#B45309` / `#FFFBEB` | `#FBBF24` / `#451A03` | `5.02:1` (`4.84:1` on bg) | — | Warnings, degraded notices |
| `border` | `#E4E4E7` | `#27272A` | — | — | 1px flat card & table borders |

---

## 3. Typography & Font System

### Font Families
- **Primary Interface Font:** `Inter` (`--font-sans`) with `tabular-nums` for all numbers, ranks, and percentages.
- **Monospace / Code Font:** `JetBrains Mono` (`--font-mono`) — restricted by `tests/test_design_rules.mjs` to raw coordinate readouts and ticker badges only.

### Font Weights
| Weight Name | Value | Usage |
|-------------|-------|-------|
| Regular | `400` | Explanatory paragraphs, subtitles, notes |
| Medium | `500` | Secondary labels, table text, inactive controls |
| Semibold | `600` | Status badges, group names, active control states |
| Bold | `700` | Page title, card headers, major financial numbers |

### Typography Scale & Semantic Roles
| Role | Font Family | Size | Weight | Tracking | Line Height | Usage |
|------|-------------|------|--------|----------|-------------|-------|
| **Page Title** | Inter | `15px` | `700` (Bold) | `-0.02em` | `18px` | Top dashboard header brand |
| **Section Title** | Inter | `12px` | `700` (Bold) | `+0.04em` | `16px` | Uppercase section titles |
| **Card Header** | Inter | `14px` | `600` (Semibold) | `-0.01em` | `20px` | Group & card headings |
| **Metric Value** | Inter (`tabular-nums`) | `13px`–`24px` | `600`–`700` | `-0.02em` | `20px`–`28px` | MED returns, ranks, counts (min `13px`) |
| **Body / Note** | Inter | `12px`–`13px` | `400` (Regular) | `-0.01em` | `18px` | Minimum informational text (`>= 12px`) |
| **Footnote** | Inter | `11px` | `500` (Medium) | `0em` | `16px` | Chart axis ticks & "as of" timestamps only |

### Tabular Figures Rule
All financial figures, prices, percentages, points, and counts **must** use `tabular-nums` (`.tnum`):
```css
.tabular-nums {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1, "cv01" 1, "cv02" 1;
}
```
This guarantees vertical digit alignment across tables, cards, and tooltips.

---

## 4. Spacing, Radius & Elevation

- **Grid Unit:** 4px baseline scale.
  - Card Padding: `p-3.5` or `p-4` (14px–16px)
  - Section Gaps: `gap-3` or `gap-3.5` (12px–14px)
  - Element Spacing: `gap-2` (8px)
- **Radius Tokens:**
  - Micro / Pill: `rounded-[4px]`
  - Button / Control: `rounded-[6px]`
  - Card / Panel: `rounded-[8px]`
  - Modal / Sheet: `rounded-[12px]`
- **Elevation:**
  - Cards: `shadow-[0_1px_2px_0_rgba(15,23,42,0.04)]` (minimal, borders preferred over heavy shadows)
  - Dropdowns: `shadow-md`

---

## 5. Chart Design System (Recharts)

All charts use centralized presets defined in `src/lib/chart-theme.js`:

```javascript
import { CHART_THEME } from "@/lib/chart-theme";
```

### Chart Conventions:
1. **Responsive Dimensions:** Every chart uses `ResponsiveContainer` with responsive auto-resizing.
2. **Subtle Grids:** Horizontal grid lines only (`stroke="#F1F5F9"`, `strokeDasharray="3 3"`). No vertical grid lines.
3. **Axis Styling:** Minimal font size (`10px`), muted color (`#94A3B8`), tick lines hidden.
4. **Tooltips:** Clean white tooltip with `#E5EAF2` border, subtle shadow, date header, and color-coded indicator dots (`ChartTooltip`).
5. **Diverging Bar Charts:**
   - Blue (`#3478F6`) or Green (`#16A878`) for positive values above zero line.
   - Pink (`#F05283`) for negative values below zero line.

---

## 6. Financial Data Visualization Rules

- **Currency:** Indian Rupee (`₹`) formatted with standard Indian grouping:
  - Thousands: `₹1,234`
  - Crores: `₹5,737 Cr`
- **Percentage:** Always explicitly signed when representing change: `+2.45%` (green) or `-1.20%` (pink).
- **Tabular Alignment:** All numerical data in tables and cards right-aligned with monospace/tabular digits.
- **Never Rely Solely on Color:** Pair colors with signs (`+` / `−`), arrows (`▲` / `▼`), or explicit text labels (`Up`, `Down`, `Held`).

---

## 7. Reusable Component Catalog

### UI Components (`src/components/ui/`)
- `Button`: `PrimaryButton`, `SecondaryButton`, `OutlineButton`, `GhostButton`, `DestructiveButton`, `IconButton`
- `BaseCard`, `SectionCard`, `ChartCard`, `MetricCard`, `StatCard`, `InformationCard`
- `StatusBadge`, `PillBadge`
- `SegmentedControl` (e.g. `20D / 50D / 200D`, `1M / 3M / 1Y`)
- `Select`, `Input`, `SearchInput`

### Data Display Components (`src/components/data-display/`)
- `MetricValue`: Formatted Indian numbers and currency.
- `PercentageChange`: Color-coded change with direction arrows.
- `TrendIndicator`: Labeled status with colored indicator dots.
- `LoadingSkeleton`: Polished placeholder while data loads.
- `EmptyState`: Clean icon + message layout.

### Charts (`src/components/charts/`)
- `BaseAreaChart`: Area fill with gradient and optional benchmark line.
- `BaseLineChart`: Multi-line time series.
- `DivergingBarChart`: Signed positive/negative bars around a zero reference.
- `ComparisonChart`: Multi-series comparative performance.
- `SparklineChart`: Compact inline trend sparkline.
- `ChartTooltip`: Centralized financial tooltip formatter.

### Layout & Navigation (`src/components/shared/` & `src/components/layout/`)
- `PageContainer`: Standardized 100% full-width responsive canvas.
- `SectionHeader`: Section title with tooltip and action controls.
- `DashboardHeader`: Product title, active tabs, universe selector, and period switch.

### Tab 3: Industries Components (`src/components/industry-strength/`)
- `TopGroupsStrip`: Headline "Best Across All Timeframes" (`1D/1W/1M/3M` minimax with `cutoff = max(5, ceil(0.20 * N))`). Mobile (`< 1024px`) renders a horizontal scroll-snap strip (`w-[88%]` cards so the next card peeks); desktop (`>= 1024px`) renders a 3-column grid. Only qualifying groups (`worst_rank <= cutoff`) render as top cards; if `< 3` qualify shows `"Only N groups are in the top {cutoff} on all four timeframes today."`; if `0` qualify shows `"No industry is in the top {cutoff} on all four timeframes today."` plus a collapsed-by-default `"Closest (not meeting the cut-off)"` toggle with cards marked `"Below cut-off · worst #N"`. Includes skeleton and empty states.
- `ControlBar`: Sticky single-row horizontally scrollable bar (`sticky top-0 z-20`) with level chips (`Macro` / `Sector` / `Industry` / `Basic industry`), timeframe chips (`1D`–`YTD`), search toggle, and filter `BottomSheet` (`All NSE` / `Liquid Only`, `Show small groups`, `More columns`).
- `MarketSnapshot`: Compact 3-stat header row (`Strongest`, `Weakest`, `Beat NIFTY 500`) that expands on tap to show underperforming, improving, and weakening counts.
- `GroupRowList`: Mobile (`< 1024px`) ranked list (~64 px collapsed row, 15-row paging with `Show 15 more · N left`). One row expands inline at a time (`expandedId`) with all timeframe medians, `>20E`/`>200D`, `RS-STS`, `Adv/Dec`, `Compare`, and `Open stocks`.
- `RankingTable`: Desktop (`>= 1024px`) sticky-header table (`max-w-[1280px]`) showing `Rank (+change)`, `Group`, `Stocks`, `MED`, `20D H/L`, `>50 SMA`, `RS-STS`, and `Compare` by default.
- `RankPrimitives` (`RankBadge`, `RankChangeChip`, `SignedReturn`, `format20dHL`): Shared tabular primitives (`tabular-nums`), enforcing colour + sign/arrow on every return and rank move, and `"—"` for null/unverified `20D H/L`.
- `BottomSheet`: Accessible modal sheet (Esc + backdrop close, `duration-150`) used for mobile Filters and the mobile Rotation Chart.

### Tab 4: Daily Plan (`src/components/plan/` & `src/app/(terminal)/plan/`)
- `DailyPlanPage` (`src/app/(terminal)/plan/page.jsx`): Server-rendered wrapper inside `AppShell` hosting `DailyPlanView`.
- `DailyPlanView` (`src/components/plan/DailyPlanView.tsx`): Top-down 6-block routine (`/plan`): header with stored-date picker + P3 summary, `1. Market State` card, `2. Where Money Is Going` cap-leadership card (`Large Cap · NIFTY 50` label for NIFTY 100 breadth), `3. Breakouts & Stage 2` card (`Stage 2: close > SMA150 & 20D slope >= 1%`), `4. Top 3 Industries` (`TopGroupsStrip` reuse + `"Industries as of <date>"` badge when stale), and `5. Final Candidates` grouped visually by qualifying Top-3 industry (max `5` per industry, `+N more in <industry> (not shown)`, reasoned empty states via `candidate_reason`, 64 px mobile rows / desktop table, Copy/CSV, lazy client-side pattern tags with concurrency 4, and `StockChartModal` drill-in). Uses `BaseCard` (`bg-surface`), `bg-bg-secondary`, `text-text`, `text-text-secondary`, `bg-primary-subtle text-primary dark:text-indigo-300`, `bg-warning-bg text-warning`, `SignedReturn`, `BottomSheet`, `StockChartModal`, Inter + `tabular-nums`, `>= 12px` labels, and `>= 13px` data values.

### Tab 5: Track Record (`src/components/track-record/` & `src/app/(terminal)/track-record/`)
- `TrackRecordPage` (`src/app/(terminal)/track-record/page.jsx`): Suspense wrapper for `TrackRecordView`.
- `TrackRecordView` (`src/components/track-record/TrackRecordView.tsx`): Measures realised 1/5/10/20-session outcomes of Daily Plan candidates vs `same_filter_any_industry`, `top_industries_any_stock` controls, and `all_liquid` baseline (`/track-record`). Sticky control bar (`1D/5D/10D/20D`, `From next open` / `From plan-date close`, `Live only`, `First appearance only`, `Filter only` / `Displayed (live)`, `Include superseded backfill`), 4-row summary table + `"Context"` block with cap-segment table (`Nifty 100`, `Midcap 150`, `Smallcap 250`, `Outside Nifty 500`) and `Too few to judge (n=...)` when `n < 30`, Recharts excess-return histogram (`var(--color-primary)`, `var(--color-text-muted)`), expandable last-30 plan dates table (`— not yet`, `no data`), and `"How this is measured"` definition box. Uses `BaseCard`, `SignedReturn`, `bg-primary-subtle text-primary dark:text-indigo-300`, `bg-warning-bg text-warning`, `>= 12px` labels, `>= 13px` data values, zero `font-mono`.

### Global Search & Chart Overlay (`src/components/shared/`)
- `GlobalSearchPalette`: Mounted in `AppShell`, opens on `Cmd/Ctrl+K` or header button, debounced 150 ms search via `/api/stock-search?q=`, keyboard navigation (`↑`/`↓`/`Enter`/`Esc`), opens `StockChartModal` (`source=search`). Never overrides `Cmd+C`.
- `StockChartModal`: Full-viewport candlestick + volume + 50/200 SMA + auto-pattern overlay (`source=industry` or `source=search`), `6M`/`1Y` range persisted in `localStorage`, `F` full-screen toggle (Fullscreen API + CSS fallback), `←`/`→` prev/next stock navigation, `Esc` close.
- `GroupDetails`: Right-hand 580 px overlay drawer on desktop (`>= 1024px`) with scrim, full-height sheet on phone, `Esc` closes and restores row focus.
- `RotationChart`: Collapsible compare panel directly under `TopGroupsStrip` on desktop (and `BottomSheet` on phone), opens automatically on first Compare click, supports 1+ groups ("Add more groups to compare" hint).

## Tab 3 Patterns & Mobile Rules
- **Page Order**: Compact header + `MarketSnapshot` → sticky `ControlBar` → `TopGroupsStrip` → ranked list/table; Rotation Chart opens from the sticky Compare bottom bar (`BottomSheet` on phone, collapsible panel under Top 3 on desktop).
- **Mobile Row Density**: Key metric (`MED`) first on line 1; `<= 3` visible values per row line; ~64 px collapsed height; 15-row paging; single expanded row at a time.
- **Colour-Plus-Sign Rule**: Every return and rank move pairs colour (`text-success` / `text-danger`) with an explicit `+`/`-` sign or arrow icon.
- **States**: Every data block implements skeleton loading, reasoned empty state, and error banner with `Retry`. No animation beyond hover, scroll-snap, and `<= 150 ms` sheet transitions.
