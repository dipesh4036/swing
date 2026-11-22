/**
 * Pattern Detection Engine
 * Pure JavaScript detection of chart geometry on daily candles.
 *
 * INDEX ALIGNMENT GUARANTEE (U7):
 * All bar indices returned in pattern objects (line idx1/idx2, touches[].idx,
 * events[].idx, leg_start.idx, and base_box.start_idx/end_idx) correspond directly
 * to the original rawCandles array passed by the caller, preserving full 1-to-1
 * alignment even when bad candles are pruned or a 250-bar lookback window is sliced.
 */
import { PATTERN_PARAMS } from './params.js';
import { computeATR } from './atr.js';
import { findPivots } from './pivots.js';
import { findHorizontalPatterns } from './horizontal.js';
import { findTrendlines } from './trendlines.js';
import { findTriangles } from './triangles.js';
import { findBasePatterns } from './base.js';
import { describePattern } from './explain.js';

export { PATTERN_PARAMS } from './params.js';

/**
 * Remaps local detector candle indices to original caller array indices.
 */
function remapPatternIndices(pat, origIdx) {
  const mapI = (idx) => (typeof idx === 'number' && origIdx[idx] !== undefined ? origIdx[idx] : idx);

  const remappedLines = (pat.lines || []).map((l) => ({
    ...l,
    idx1: mapI(l.idx1),
    idx2: mapI(l.idx2),
    touches: (l.touches || []).map((t) => ({
      ...t,
      idx: mapI(t.idx),
    })),
  }));

  const remappedEvents = (pat.events || []).map((ev) => ({
    ...ev,
    idx: mapI(ev.idx),
  }));

  const remappedLegStart = pat.leg_start
    ? {
        ...pat.leg_start,
        idx: mapI(pat.leg_start.idx),
      }
    : undefined;

  const remappedBaseBox = pat.base_box
    ? {
        ...pat.base_box,
        start_idx: mapI(pat.base_box.start_idx),
        end_idx: mapI(pat.base_box.end_idx),
      }
    : undefined;

  return {
    ...pat,
    lines: remappedLines,
    events: remappedEvents,
    ...(remappedLegStart ? { leg_start: remappedLegStart } : {}),
    ...(remappedBaseBox ? { base_box: remappedBaseBox } : {}),
  };
}

/**
 * Detects chart patterns on a series of daily candles.
 *
 * @param {Array<{date: string, open: number, high: number, low: number, close: number, volume?: number}>} rawCandles
 * @returns {{ patterns: Array<object>, reason: string | null }}
 */
export function detectPatterns(rawCandles) {
  if (!Array.isArray(rawCandles)) {
    return { patterns: [], reason: 'insufficient_history' };
  }

  // 1. Clean candles: track original index (U7)
  const cleaned = [];
  const origIndices = [];
  for (let i = 0; i < rawCandles.length; i++) {
    const c = rawCandles[i];
    if (
      c &&
      typeof c.open === 'number' && !isNaN(c.open) &&
      typeof c.high === 'number' && !isNaN(c.high) &&
      typeof c.low === 'number' && !isNaN(c.low) &&
      typeof c.close === 'number' && !isNaN(c.close) &&
      c.high > 0 && c.low > 0 && c.close > 0 && c.open > 0
    ) {
      cleaned.push({
        date: String(c.date || ''),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: typeof c.volume === 'number' && !isNaN(c.volume) ? c.volume : 0,
      });
      origIndices.push(i);
    }
  }

  // 2. Minimum history guard
  if (cleaned.length < PATTERN_PARAMS.min_history_bars) {
    return { patterns: [], reason: 'insufficient_history' };
  }

  // 3. Lookback window: up to max_lookback_bars (250)
  const offset = cleaned.length > PATTERN_PARAMS.max_lookback_bars
    ? cleaned.length - PATTERN_PARAMS.max_lookback_bars
    : 0;
  const candles = cleaned.slice(offset);
  const candleOrigIdx = origIndices.slice(offset);

  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) {
    return { patterns: [], reason: 'insufficient_history' };
  }

  // 4. Precompute ATR and swing pivots
  const atrs = computeATR(candles, PATTERN_PARAMS.atr_period);
  const pivots = findPivots(candles, atrs, PATTERN_PARAMS.pivot_k, PATTERN_PARAMS.pivot_prominence_atr);

  // 5. Run detectors
  const candidates = [
    ...findHorizontalPatterns(candles, atrs, pivots),
    ...findTrendlines(candles, atrs, pivots),
    ...findTriangles(candles, atrs, pivots),
    ...findBasePatterns(candles, atrs, pivots),
  ];

  if (candidates.length === 0) {
    return { patterns: [], reason: null };
  }

  // 6. Enrich with explanations and rule descriptions
  const enriched = candidates.map((p) => {
    const { summary, rule_text } = describePattern(p);
    return {
      ...p,
      summary,
      rule_text,
    };
  });

  // 7. Ordering (geometric relevance, NOT a score):
  //    (1) patterns with an event or at_line in the last 3 bars first
  //    (2) more touches
  //    (3) longer span
  const lastBarIdx = n - 1;
  enriched.sort((a, b) => {
    const aRecentEvent = (a.status === 'at_line') ||
      a.events.some((ev) => ev.idx >= lastBarIdx - 3);
    const bRecentEvent = (b.status === 'at_line') ||
      b.events.some((ev) => ev.idx >= lastBarIdx - 3);

    if (aRecentEvent && !bRecentEvent) return -1;
    if (!aRecentEvent && bRecentEvent) return 1;

    if (b.metrics.touches !== a.metrics.touches) {
      return b.metrics.touches - a.metrics.touches;
    }
    return b.metrics.span_bars - a.metrics.span_bars;
  });

  // 8. Deduplicate: at most 1 per (type, side, overlapping window)
  //    and if two patterns share >= 70% of the same line, keep the higher-ranked one.
  const deduplicated = [];
  for (const pat of enriched) {
    const mainLine = pat.lines[0];
    const isDup = deduplicated.some((existing) => {
      // Check 1 per (type, side, overlapping window)
      if (existing.type === pat.type && existing.side === pat.side) {
        const startOverlap = Math.max(existing.lines[0].idx1, mainLine.idx1);
        const endOverlap = Math.min(existing.lines[0].idx2, mainLine.idx2);
        if (endOverlap > startOverlap) return true;
      }

      // Check if they share >= 70% of the same line
      const exLine = existing.lines[0];
      const startOverlap = Math.max(exLine.idx1, mainLine.idx1);
      const endOverlap = Math.min(exLine.idx2, mainLine.idx2);
      if (endOverlap <= startOverlap) return false;
      const overlapLen = endOverlap - startOverlap;
      const minSpan = Math.min(exLine.idx2 - exLine.idx1, mainLine.idx2 - mainLine.idx1);
      return minSpan > 0 && overlapLen / minSpan >= PATTERN_PARAMS.line_overlap_threshold;
    });

    if (!isDup) {
      deduplicated.push(pat);
    }
  }

  // 9. Cap to max_patterns_returned (8)
  const capped = deduplicated.slice(0, PATTERN_PARAMS.max_patterns_returned);

  // 10. Remap indices to original rawCandles coordinates (U7)
  const finalPatterns = capped.map((p) => remapPatternIndices(p, candleOrigIdx));

  return {
    patterns: finalPatterns,
    reason: null,
  };
}
