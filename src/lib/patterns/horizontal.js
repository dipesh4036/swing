/**
 * Horizontal Ceiling & Floor Pattern Detection
 * Identifies horizontal support/resistance levels formed by clustered swing points.
 * Implements U8 (status aging, single events) and U9 (full span no-pierce check).
 */
import { PATTERN_PARAMS } from './params.js';

/**
 * Evaluates breakout, retest, and back-inside events for a horizontal line.
 * Caps events to at most 1 breakout/breakdown, 1 retest, and 1 close_back_inside (U8).
 */
function evaluateEvents(candles, atrs, level, side, lastTouchIdx) {
  const n = candles.length;
  let broke = false;
  let breakoutIdx = -1;
  let piercedAfter = false;
  const isResistance = side === 'resistance';

  let breakoutEvent = null;
  let retestEvent = null;
  let closeBackInsideEvent = null;

  for (let i = lastTouchIdx + 1; i < n; i++) {
    const c = candles[i];
    const atr = atrs[i] || 1;
    const diff = c.close - level;

    if (!broke) {
      if (isResistance && diff > PATTERN_PARAMS.breakout_atr * atr) {
        broke = true;
        breakoutIdx = i;
        breakoutEvent = {
          type: 'breakout',
          idx: i,
          date: c.date,
          price: c.close,
        };
      } else if (!isResistance && diff < -PATTERN_PARAMS.breakout_atr * atr) {
        broke = true;
        breakoutIdx = i;
        breakoutEvent = {
          type: 'breakdown',
          idx: i,
          date: c.date,
          price: c.close,
        };
      } else {
        // Check if close pierced before breaking (U9)
        const penetration = isResistance ? diff : -diff;
        if (penetration > PATTERN_PARAMS.pierce_tol * atr) {
          piercedAfter = true;
          break;
        }
      }
    } else {
      // Already broken: record at most 1 retest and at most 1 close_back_inside (U8)
      const distToLevel = Math.abs(c.close - level) / atr;
      const extremumDist = isResistance
        ? Math.abs(c.low - level) / atr
        : Math.abs(c.high - level) / atr;

      if (!retestEvent && (distToLevel <= PATTERN_PARAMS.retest_atr || extremumDist <= PATTERN_PARAMS.retest_atr)) {
        retestEvent = {
          type: 'retest',
          idx: i,
          date: c.date,
          price: c.close,
        };
      }

      if (!closeBackInsideEvent) {
        if (isResistance && c.close < level) {
          closeBackInsideEvent = {
            type: 'close_back_inside',
            idx: i,
            date: c.date,
            price: c.close,
          };
        } else if (!isResistance && c.close > level) {
          closeBackInsideEvent = {
            type: 'close_back_inside',
            idx: i,
            date: c.date,
            price: c.close,
          };
        }
      }
    }
  }

  const events = [];
  if (breakoutEvent) events.push(breakoutEvent);
  if (retestEvent) events.push(retestEvent);
  if (closeBackInsideEvent) events.push(closeBackInsideEvent);

  return { broke, breakoutIdx, events, piercedAfter };
}

/**
 * Finds horizontal ceiling and floor patterns.
 * @param {Array<{open: number, high: number, low: number, close: number, date: string}>} candles
 * @param {number[]} atrs
 * @param {{ highs: Array<{idx: number, price: number, date: string, atr: number}>, lows: Array<{idx: number, price: number, date: string, atr: number}> }} pivots
 * @returns {Array<object>} Array of detected horizontal pattern candidate objects
 */
export function findHorizontalPatterns(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const patterns = [];

  const sides = [
    { name: 'resistance', type: 'horizontal_ceiling', title: 'Horizontal ceiling', points: pivots.highs },
    { name: 'support', type: 'horizontal_floor', title: 'Horizontal floor', points: pivots.lows },
  ];

  for (const { name: side, type, title, points } of sides) {
    if (points.length < PATTERN_PARAMS.min_touches) continue;

    // Cluster swing points by proximity in ATR units
    const clusters = [];
    const used = new Set();

    for (let i = 0; i < points.length; i++) {
      if (used.has(i)) continue;
      const cluster = [points[i]];
      const baseAtr = points[i].atr || 1;

      for (let j = i + 1; j < points.length; j++) {
        const diffAtr = Math.abs(points[j].price - points[i].price) / baseAtr;
        if (diffAtr <= PATTERN_PARAMS.touch_tol) {
          cluster.push(points[j]);
        }
      }

      if (cluster.length >= PATTERN_PARAMS.min_touches) {
        // Enforce touch separation
        const validTouches = [cluster[0]];
        for (let k = 1; k < cluster.length; k++) {
          if (cluster[k].idx - validTouches[validTouches.length - 1].idx >= PATTERN_PARAMS.min_bars_between_touches) {
            validTouches.push(cluster[k]);
          }
        }

        if (validTouches.length >= PATTERN_PARAMS.min_touches) {
          clusters.push(validTouches);
          for (const p of validTouches) {
            const origIdx = points.findIndex((pt) => pt.idx === p.idx);
            if (origIdx >= 0) used.add(origIdx);
          }
        }
      }
    }

    // Evaluate each cluster
    for (const touches of clusters) {
      const prices = touches.map((t) => t.price).sort((a, b) => a - b);
      const medianLevel = prices[Math.floor(prices.length / 2)];
      const firstTouch = touches[0];
      const lastTouch = touches[touches.length - 1];
      const spanBars = lastTouch.idx - firstTouch.idx;

      if (spanBars < PATTERN_PARAMS.min_span_bars || spanBars > PATTERN_PARAMS.max_span_bars) {
        continue;
      }

      // Check piercing over FULL span firstTouch.idx .. lastTouch.idx (U9)
      let pierced = false;
      const isResistance = side === 'resistance';

      for (let bar = firstTouch.idx; bar <= lastTouch.idx; bar++) {
        const c = candles[bar];
        const barAtr = atrs[bar] || 1;
        if (isResistance && (c.close - medianLevel) > PATTERN_PARAMS.pierce_tol * barAtr) {
          pierced = true;
          break;
        } else if (!isResistance && (medianLevel - c.close) > PATTERN_PARAMS.pierce_tol * barAtr) {
          pierced = true;
          break;
        }
      }

      if (pierced) continue;

      // Evaluate breakout, retest, and back inside events (U8, U9)
      const { broke, breakoutIdx, events, piercedAfter } = evaluateEvents(
        candles,
        atrs,
        medianLevel,
        side,
        lastTouch.idx
      );

      if (piercedAfter) continue;

      // Status determination from CURRENT state (U8)
      const lastBarIdx = n - 1;
      const lastClose = candles[lastBarIdx].close;
      const lastAtr = atrs[lastBarIdx] || 1;
      const diffAtr = (lastClose - medianLevel) / lastAtr;

      let status = 'forming';
      if (broke) {
        const breakAge = lastBarIdx - breakoutIdx;
        if (breakAge > PATTERN_PARAMS.recent_break_bars) {
          status = 'historical';
        } else {
          // Check if last close is still beyond line
          const stillBeyond = isResistance ? lastClose >= medianLevel : lastClose <= medianLevel;
          if (stillBeyond) {
            status = isResistance ? 'broke_out' : 'broke_down';
          } else {
            status = 'failed_break';
          }
        }
      } else {
        // Unbroken: forming or at_line. Check max_pattern_age_bars (U8.3)
        const ageSinceTouch = lastBarIdx - lastTouch.idx;
        if (ageSinceTouch > PATTERN_PARAMS.max_pattern_age_bars) {
          continue; // Drop pattern if last touch is older than max_pattern_age_bars
        }
        if (Math.abs(diffAtr) <= PATTERN_PARAMS.at_line_atr) {
          status = 'at_line'; // Testing
        } else {
          status = 'forming';
        }
      }

      patterns.push({
        id: `${type}_${firstTouch.idx}_${lastTouch.idx}`,
        type,
        side,
        status,
        title,
        level: medianLevel,
        lines: [
          {
            role: side,
            idx1: firstTouch.idx,
            p1: medianLevel,
            idx2: lastTouch.idx,
            p2: medianLevel,
            slope: 0,
            touches: touches.map((t) => ({ idx: t.idx, price: t.price, date: t.date })),
          },
        ],
        band: { half_width_atr: PATTERN_PARAMS.retest_band_half_width_atr },
        events,
        window: {
          start_date: candles[firstTouch.idx].date,
          end_date: candles[lastTouch.idx].date,
          found_date: candles[n - 1].date,
        },
        metrics: {
          touches: touches.length,
          atr_beyond: Number(diffAtr.toFixed(2)),
          span_bars: spanBars,
        },
      });
    }
  }

  return patterns;
}
