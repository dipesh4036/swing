/**
 * Sloped Trendline Pattern Detection
 * Identifies resistance and support trendlines in ln(price) space.
 * Implements U8 (status aging, single events) and U9 (full span no-pierce check).
 */
import { PATTERN_PARAMS } from './params.js';

/**
 * Evaluates line price in linear space from ln-space slope and intercept.
 */
export function getLinePrice(idx1, p1, slope, targetIdx) {
  const lnP1 = Math.log(p1);
  const targetLn = lnP1 + slope * (targetIdx - idx1);
  return Math.exp(targetLn);
}

/**
 * Evaluates breakout, retest, and back-inside events for a sloped line.
 * Caps events to at most 1 breakout/breakdown, 1 retest, and 1 close_back_inside (U8).
 */
function evaluateSlopedEvents(candles, atrs, idx1, p1, slope, side, lastTouchIdx) {
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
    const linePrice = getLinePrice(idx1, p1, slope, i);
    const diff = c.close - linePrice;

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
        // Check piercing before breaking (U9)
        const penetration = isResistance ? diff : -diff;
        if (penetration > PATTERN_PARAMS.pierce_tol * atr) {
          piercedAfter = true;
          break;
        }
      }
    } else {
      // Already broken: record at most 1 retest and at most 1 close_back_inside (U8)
      const distToLine = Math.abs(c.close - linePrice) / atr;
      const extremumDist = isResistance
        ? Math.abs(c.low - linePrice) / atr
        : Math.abs(c.high - linePrice) / atr;

      if (!retestEvent && (distToLine <= PATTERN_PARAMS.retest_atr || extremumDist <= PATTERN_PARAMS.retest_atr)) {
        retestEvent = {
          type: 'retest',
          idx: i,
          date: c.date,
          price: c.close,
        };
      }

      if (!closeBackInsideEvent) {
        if (isResistance && c.close < linePrice) {
          closeBackInsideEvent = {
            type: 'close_back_inside',
            idx: i,
            date: c.date,
            price: c.close,
          };
        } else if (!isResistance && c.close > linePrice) {
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
 * Finds sloped trendline patterns.
 * @param {Array<{open: number, high: number, low: number, close: number, date: string}>} candles
 * @param {number[]} atrs
 * @param {{ highs: Array<{idx: number, price: number, date: string, atr: number}>, lows: Array<{idx: number, price: number, date: string, atr: number}> }} pivots
 * @returns {Array<object>} Detected trendlines
 */
export function findTrendlines(candles, atrs, pivots) {
  const n = candles.length;
  if (n < PATTERN_PARAMS.min_history_bars) return [];
  const candidatePatterns = [];

  const sides = [
    { name: 'resistance', type: 'sloped_resistance', title: 'Resistance trendline', points: pivots.highs },
    { name: 'support', type: 'sloped_support', title: 'Support trendline', points: pivots.lows },
  ];

  for (const { name: side, type, title, points } of sides) {
    if (points.length < PATTERN_PARAMS.min_touches_line) continue;

    // Cap points to 30 most recent and precompute lnP for fast math
    const activePoints = points.slice(-30).map((pt) => ({
      ...pt,
      lnP: Math.log(pt.price),
    }));
    const validLines = [];
    const isResistance = side === 'resistance';

    for (let i = 0; i < activePoints.length; i++) {
      for (let j = i + 1; j < activePoints.length; j++) {
        const pA = activePoints[i];
        const pB = activePoints[j];
        const spanBars = pB.idx - pA.idx;

        if (spanBars < PATTERN_PARAMS.min_span_bars || spanBars > PATTERN_PARAMS.max_span_bars) {
          continue;
        }

        const slope = (pB.lnP - pA.lnP) / spanBars;
        if (Math.abs(slope) > PATTERN_PARAMS.max_slope_pct_per_bar) {
          continue;
        }

        // Count touches across all activePoints
        const touches = [];
        const lnPA = pA.lnP;
        for (const pt of activePoints) {
          const expectedP = Math.exp(lnPA + slope * (pt.idx - pA.idx));
          const distAtr = Math.abs(pt.price - expectedP) / (pt.atr || 1);
          if (distAtr <= PATTERN_PARAMS.touch_tol) {
            touches.push(pt);
          }
        }

        // Filter touches to ensure at least min_bars_between_touches
        const spacedTouches = [];
        for (const t of touches) {
          if (
            spacedTouches.length === 0 ||
            t.idx - spacedTouches[spacedTouches.length - 1].idx >= PATTERN_PARAMS.min_bars_between_touches
          ) {
            spacedTouches.push(t);
          }
        }

        if (spacedTouches.length < PATTERN_PARAMS.min_touches_line) {
          continue;
        }

        const firstTouch = spacedTouches[0];
        const lastTouch = spacedTouches[spacedTouches.length - 1];
        const totalSpan = lastTouch.idx - firstTouch.idx;

        if (totalSpan < PATTERN_PARAMS.min_span_bars || totalSpan > PATTERN_PARAMS.max_span_bars) {
          continue;
        }

        // U9: Validate no-pierce rule over the FULL drawn span firstTouch.idx .. lastTouch.idx
        let pierced = false;
        let nearPierces = 0;
        const lnFirst = firstTouch.lnP;

        for (let bar = firstTouch.idx; bar <= lastTouch.idx; bar++) {
          const c = candles[bar];
          const barAtr = atrs[bar] || 1;
          const lineP = Math.exp(lnFirst + slope * (bar - firstTouch.idx));

          if (isResistance) {
            const diff = c.close - lineP;
            if (diff > PATTERN_PARAMS.pierce_tol * barAtr) {
              pierced = true;
              break;
            } else if (diff > 0) {
              nearPierces++;
            }
          } else {
            const diff = lineP - c.close;
            if (diff > PATTERN_PARAMS.pierce_tol * barAtr) {
              pierced = true;
              break;
            } else if (diff > 0) {
              nearPierces++;
            }
          }
        }

        if (pierced) continue;

        validLines.push({
          pA,
          pB,
          slope,
          firstTouch,
          lastTouch,
          touches: spacedTouches,
          nearPierces,
          spanBars: totalSpan,
        });
      }
    }

    if (validLines.length === 0) continue;

    // Rank candidate lines: more touches, longer span, fewer near-pierces
    validLines.sort((a, b) => {
      if (b.touches.length !== a.touches.length) {
        return b.touches.length - a.touches.length;
      }
      if (b.spanBars !== a.spanBars) {
        return b.spanBars - a.spanBars;
      }
      return a.nearPierces - b.nearPierces;
    });

    // Keep the best non-overlapping lines
    const kept = [];
    for (const line of validLines) {
      const overlaps = kept.some((k) => {
        const overlapStart = Math.max(k.firstTouch.idx, line.firstTouch.idx);
        const overlapEnd = Math.min(k.lastTouch.idx, line.lastTouch.idx);
        if (overlapEnd <= overlapStart) return false;
        const overlapLen = overlapEnd - overlapStart;
        return overlapLen / Math.min(k.spanBars, line.spanBars) >= PATTERN_PARAMS.line_overlap_threshold;
      });

      if (!overlaps) {
        kept.push(line);
        if (kept.length >= 2) break;
      }
    }

    for (const line of kept) {
      const { firstTouch, lastTouch, slope, touches } = line;
      const { broke, breakoutIdx, events, piercedAfter } = evaluateSlopedEvents(
        candles,
        atrs,
        firstTouch.idx,
        firstTouch.price,
        slope,
        side,
        lastTouch.idx
      );

      // U9: Reject if pierced between last touch and last bar without breakout
      if (piercedAfter) continue;

      const lastBarIdx = n - 1;
      const lastClose = candles[lastBarIdx].close;
      const lastAtr = atrs[lastBarIdx] || 1;
      const currentLinePrice = getLinePrice(firstTouch.idx, firstTouch.price, slope, lastBarIdx);
      const diffAtr = (lastClose - currentLinePrice) / lastAtr;

      let status = 'forming';
      if (broke) {
        const breakAge = lastBarIdx - breakoutIdx;
        if (breakAge > PATTERN_PARAMS.recent_break_bars) {
          status = 'historical';
        } else {
          // Check if last close is still beyond line (U8)
          const stillBeyond = isResistance ? lastClose >= currentLinePrice : lastClose <= currentLinePrice;
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
          status = 'at_line';
        } else {
          status = 'forming';
        }
      }

      candidatePatterns.push({
        id: `${type}_${firstTouch.idx}_${lastTouch.idx}`,
        type,
        side,
        status,
        title: `${title} ×${touches.length}`,
        lines: [
          {
            role: side,
            idx1: firstTouch.idx,
            p1: firstTouch.price,
            idx2: lastTouch.idx,
            p2: getLinePrice(firstTouch.idx, firstTouch.price, slope, lastTouch.idx),
            slope,
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
          span_bars: line.spanBars,
        },
      });
    }
  }

  return candidatePatterns;
}
