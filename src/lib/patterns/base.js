/**
 * Base + Pivot Pattern Detection
 * Identifies upward momentum thrust followed by a tight consolidation base.
 * Implements U8 (status aging, single events) and U11 (strict age cap, full-span low, single base).
 */
import { PATTERN_PARAMS } from './params.js';

export function findBasePatterns(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const basePatterns = [];

  const lows = pivots.lows;
  if (lows.length === 0) return [];

  const lastBarIdx = n - 1;

  // 50-bar average volume
  const vol50 = new Array(n).fill(0);
  let volSum = 0;
  for (let i = 0; i < n; i++) {
    volSum += candles[i].volume || 0;
    if (i >= PATTERN_PARAMS.volume_avg_bars) {
      volSum -= candles[i - PATTERN_PARAMS.volume_avg_bars].volume || 0;
      vol50[i] = volSum / PATTERN_PARAMS.volume_avg_bars;
    } else {
      volSum += volSum / (i + 1);
    }
  }

  // Scan swing lows as potential leg starts
  for (const legLow of lows) {
    const startIdx = legLow.idx;
    const startPrice = legLow.price;
    const maxLegEnd = Math.min(lastBarIdx - PATTERN_PARAMS.base_min_bars, startIdx + PATTERN_PARAMS.leg_max_bars);

    if (maxLegEnd <= startIdx) continue;

    // Find highest high in the leg window (pivot)
    let pivotPrice = -1;
    let pivotIdx = -1;

    for (let i = startIdx + 1; i <= maxLegEnd; i++) {
      if (candles[i].high > pivotPrice) {
        pivotPrice = candles[i].high;
        pivotIdx = i;
      }
    }

    if (pivotIdx < 0) continue;

    // U11.1: Rise percentage must meet minimum thrust
    const risePct = ((pivotPrice - startPrice) / startPrice) * 100;
    if (risePct < PATTERN_PARAMS.leg_min_rise_pct) continue;

    // U11.1: Base is consolidation after the peak and must be at most base_max_bars (40) long measured to the LAST bar
    const baseDuration = lastBarIdx - pivotIdx;
    if (baseDuration < PATTERN_PARAMS.base_min_bars || baseDuration > PATTERN_PARAMS.base_max_bars) {
      continue;
    }

    // U11.3: Base low = lowest low from the pivot to the last bar (not a capped window)
    let baseLow = Infinity;
    let baseLowIdx = -1;
    for (let i = pivotIdx; i <= lastBarIdx; i++) {
      if (candles[i].low < baseLow) {
        baseLow = candles[i].low;
        baseLowIdx = i;
      }
    }

    // Check base depth using full-span low
    const depthPct = ((pivotPrice - baseLow) / pivotPrice) * 100;
    if (depthPct > PATTERN_PARAMS.base_max_depth_pct || depthPct <= 0) continue;

    // Check breakout & events
    let broke = false;
    let breakIdx = -1;
    let volRatio = 1.0;
    let hasInvalidHigh = false;

    let breakoutEvent = null;
    let retestEvent = null;
    let closeBackInsideEvent = null;

    for (let i = pivotIdx + 1; i <= lastBarIdx; i++) {
      const c = candles[i];
      const atr = atrs[i] || 1;

      if (!broke) {
        // U11.2: No later higher highs than pivot may exist before breakout
        if (c.high > pivotPrice + PATTERN_PARAMS.breakout_atr * atr) {
          // Breakout bar
          if (c.close > pivotPrice + PATTERN_PARAMS.breakout_atr * atr) {
            broke = true;
            breakIdx = i;
            const avgV = vol50[i] || 1;
            volRatio = Number(((c.volume || 0) / avgV).toFixed(2));
            breakoutEvent = {
              type: 'breakout',
              idx: i,
              date: c.date,
              price: c.close,
            };
          } else {
            // High spiked above pivot but close failed to break: invalid higher high before breakout
            hasInvalidHigh = true;
            break;
          }
        }
      } else {
        // Already broken: track at most 1 retest and at most 1 close_back_inside (U8)
        const distAtr = Math.abs(c.close - pivotPrice) / atr;
        if (!retestEvent && distAtr <= PATTERN_PARAMS.retest_atr) {
          retestEvent = {
            type: 'retest',
            idx: i,
            date: c.date,
            price: c.close,
          };
        }
        if (!closeBackInsideEvent && c.close < pivotPrice) {
          closeBackInsideEvent = {
            type: 'close_back_inside',
            idx: i,
            date: c.date,
            price: c.close,
          };
        }
      }
    }

    if (hasInvalidHigh) continue;

    const events = [];
    if (breakoutEvent) events.push(breakoutEvent);
    if (retestEvent) events.push(retestEvent);
    if (closeBackInsideEvent) events.push(closeBackInsideEvent);

    const lastClose = candles[lastBarIdx].close;
    const lastAtr = atrs[lastBarIdx] || 1;
    const diffAtr = (lastClose - pivotPrice) / lastAtr;

    // Status determination (U8, U11.2)
    let status = 'forming';
    if (broke) {
      const breakAge = lastBarIdx - breakIdx;
      if (breakAge > PATTERN_PARAMS.recent_break_bars) {
        status = 'historical';
      } else if (lastClose >= pivotPrice) {
        status = 'broke_out';
      } else {
        status = 'failed_break';
      }
    } else if (Math.abs(diffAtr) <= PATTERN_PARAMS.at_line_atr) {
      status = 'at_line';
    }

    if (!broke) {
      const avgV = vol50[lastBarIdx] || 1;
      volRatio = Number(((candles[lastBarIdx].volume || 0) / avgV).toFixed(2));
    }

    basePatterns.push({
      id: `base_pivot_${startIdx}_${pivotIdx}`,
      type: 'base_pivot',
      side: 'resistance',
      status,
      title: 'Base + pivot',
      lines: [
        {
          role: 'pivot',
          idx1: pivotIdx,
          p1: pivotPrice,
          idx2: lastBarIdx,
          p2: pivotPrice,
          slope: 0,
          touches: [{ idx: pivotIdx, price: pivotPrice, date: candles[pivotIdx].date }],
        },
        {
          role: 'base_low',
          idx1: baseLowIdx,
          p1: baseLow,
          idx2: lastBarIdx,
          p2: baseLow,
          slope: 0,
          touches: [{ idx: baseLowIdx, price: baseLow, date: candles[baseLowIdx].date }],
        },
      ],
      leg_start: {
        idx: startIdx,
        price: startPrice,
        date: candles[startIdx].date,
      },
      base_box: {
        start_idx: pivotIdx,
        end_idx: lastBarIdx,
        top: pivotPrice,
        bottom: baseLow,
      },
      band: { half_width_atr: PATTERN_PARAMS.retest_band_half_width_atr },
      events,
      window: {
        start_date: candles[startIdx].date,
        end_date: candles[lastBarIdx].date,
        found_date: candles[lastBarIdx].date,
      },
      metrics: {
        touches: 2,
        atr_beyond: Number(diffAtr.toFixed(2)),
        span_bars: lastBarIdx - startIdx,
        volume_ratio: volRatio,
        base_depth_pct: Number(depthPct.toFixed(1)),
        prior_rise_pct: Number(risePct.toFixed(1)),
      },
    });
  }

  // U11.4: Keep at most 1 base per stock (most recent pivot)
  basePatterns.sort((a, b) => b.lines[0].idx1 - a.lines[0].idx1);
  return basePatterns.slice(0, 1);
}
