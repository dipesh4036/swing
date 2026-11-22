/**
 * Lightweight Charts Series Primitive for Chart Patterns
 * Draws trendlines, retest bands, touch circles, breakout/retest glyphs, and base boxes.
 */
import { getLinePrice } from '../../lib/patterns/trendlines.js';

/**
 * Custom Series Primitive implementing ISeriesPrimitive
 */
export class PatternSeriesPrimitive {
  constructor(options = {}) {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
    this._patterns = options.patterns || [];
    this._focusedPatternId = options.focusedPatternId || null;
    this._layers = options.layers || {
      patternLines: true,
      breakoutRetest: true,
      basePivot: true,
    };
    this._isDark = options.isDark || false;

    this._paneView = {
      renderer: () => ({
        draw: (target) => {
          target.useBitmapCoordinateSpace((scope) => {
            this._draw(scope);
          });
        },
      }),
    };

    this._priceAxisView = {
      coordinate: () => {
        if (!this._series || !this._focusedPattern) return -1;
        const line = this._focusedPattern.lines[0];
        if (!line) return -1;
        const price = line.p2 || line.p1;
        const coord = this._series.priceToCoordinate(price);
        return coord !== null ? coord : -1;
      },
      text: () => {
        if (!this._focusedPattern) return '';
        const side = this._focusedPattern.side;
        const touches = this._focusedPattern.metrics?.touches || 2;
        const sideText = side === 'resistance' ? 'Resistance' : side === 'support' ? 'Support' : 'Boundary';
        return `${sideText} ×${touches}`;
      },
      textColor: () => '#FFFFFF',
      backColor: () => {
        if (!this._focusedPattern) return '#71717A';
        return this._focusedPattern.side === 'support' ? '#2563EB' : '#E11D48';
      },
      visible: () => Boolean(this._focusedPattern && this._layers.patternLines),
    };
  }

  get _focusedPattern() {
    if (!this._patterns || this._patterns.length === 0) return null;
    if (this._focusedPatternId) {
      return this._patterns.find((p) => p.id === this._focusedPatternId) || this._patterns[0];
    }
    return this._patterns[0];
  }

  attached({ chart, series, requestUpdate }) {
    this._chart = chart;
    this._series = series;
    this._requestUpdate = requestUpdate;
    this._requestUpdate?.();
  }

  detached() {
    this._chart = null;
    this._series = null;
    this._requestUpdate = null;
  }

  update({ patterns, focusedPatternId, layers, isDark }) {
    if (patterns !== undefined) this._patterns = patterns;
    if (focusedPatternId !== undefined) this._focusedPatternId = focusedPatternId;
    if (layers !== undefined) this._layers = layers;
    if (isDark !== undefined) this._isDark = isDark;
    this._requestUpdate?.();
  }

  updateAllViews() {}

  paneViews() {
    return [this._paneView];
  }

  priceAxisViews() {
    return [this._priceAxisView];
  }

  timeAxisViews() {
    return [];
  }

  _draw(scope) {
    if (!this._chart || !this._series || !this._patterns || this._patterns.length === 0) return;
    const { context: ctx, horizontalPixelRatio: hRatio, verticalPixelRatio: vRatio } = scope;
    const timeScale = this._chart.timeScale();
    const series = this._series;

    const focusedId = this._focusedPattern?.id;

    for (const pat of this._patterns) {
      const isFocused = pat.id === focusedId;

      // 1. Draw Retest Band (if enabled)
      if (this._layers.breakoutRetest && pat.band && pat.lines.length > 0) {
        const line = pat.lines[0];
        const halfWidth = pat.band.half_width_atr || 0.25;
        const atr = 1.0; // ATR scaled band

        ctx.fillStyle = this._isDark ? 'rgba(161, 161, 170, 0.10)' : 'rgba(161, 161, 170, 0.16)';
        ctx.beginPath();

        let started = false;
        for (let bar = line.idx1; bar <= line.idx2; bar += 4) {
          const x = timeScale.logicalToCoordinate(bar);
          const p = getLinePrice(line.idx1, line.p1, line.slope || 0, bar);
          const y = series.priceToCoordinate(p + halfWidth * atr);
          if (x !== null && y !== null) {
            const px = x * hRatio;
            const py = y * vRatio;
            if (!started) {
              ctx.moveTo(px, py);
              started = true;
            } else {
              ctx.lineTo(px, py);
            }
          }
        }

        for (let bar = line.idx2; bar >= line.idx1; bar -= 4) {
          const x = timeScale.logicalToCoordinate(bar);
          const p = getLinePrice(line.idx1, line.p1, line.slope || 0, bar);
          const y = series.priceToCoordinate(p - halfWidth * atr);
          if (x !== null && y !== null) {
            ctx.lineTo(x * hRatio, y * vRatio);
          }
        }

        ctx.closePath();
        ctx.fill();
      }

      // 2. Draw Base Box & Pivot Line (if enabled and base pattern)
      if (this._layers.basePivot && pat.base_box) {
        const box = pat.base_box;
        const x1 = timeScale.logicalToCoordinate(box.start_idx);
        const x2 = timeScale.logicalToCoordinate(box.end_idx);
        const yTop = series.priceToCoordinate(box.top);
        const yBottom = series.priceToCoordinate(box.bottom);

        if (x1 !== null && x2 !== null && yTop !== null && yBottom !== null) {
          ctx.fillStyle = this._isDark ? 'rgba(79, 70, 229, 0.10)' : 'rgba(79, 70, 229, 0.08)';
          ctx.fillRect(
            x1 * hRatio,
            yTop * vRatio,
            (x2 - x1) * hRatio,
            (yBottom - yTop) * vRatio
          );
        }

        // Draw Leg Start Arrow & Text
        if (pat.leg_start) {
          const lsX = timeScale.logicalToCoordinate(pat.leg_start.idx);
          const lsY = series.priceToCoordinate(pat.leg_start.price);
          if (lsX !== null && lsY !== null) {
            const px = lsX * hRatio;
            const py = lsY * vRatio;
            ctx.fillStyle = '#4F46E5';
            ctx.font = `${Math.round(9 * hRatio)}px sans-serif`;
            ctx.fillText('↑ leg starts', px - 20 * hRatio, py + 14 * vRatio);
          }
        }
      }

      // 3. Draw Pattern Lines (if enabled)
      if (this._layers.patternLines) {
        const lineColor = pat.side === 'support' ? '#2563EB' : pat.type === 'base_pivot' ? '#4F46E5' : '#E11D48';
        const lineWidth = isFocused ? 2.5 * hRatio : 1.25 * hRatio;

        for (const line of pat.lines) {
          // (a) Solid segment between anchors
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = lineWidth;
          ctx.setLineDash([]);
          ctx.beginPath();

          let started = false;
          for (let bar = line.idx1; bar <= line.idx2; bar += 4) {
            const x = timeScale.logicalToCoordinate(bar);
            const p = getLinePrice(line.idx1, line.p1, line.slope || 0, bar);
            const y = series.priceToCoordinate(p);
            if (x !== null && y !== null) {
              const px = x * hRatio;
              const py = y * vRatio;
              if (!started) {
                ctx.moveTo(px, py);
                started = true;
              } else {
                ctx.lineTo(px, py);
              }
            }
          }
          // Ensure exact anchor end
          const endX = timeScale.logicalToCoordinate(line.idx2);
          const endY = series.priceToCoordinate(line.p2);
          if (endX !== null && endY !== null) {
            ctx.lineTo(endX * hRatio, endY * vRatio);
          }
          ctx.stroke();

          // (b) Dashed forward extension (15 bars)
          ctx.beginPath();
          ctx.setLineDash([4 * hRatio, 4 * hRatio]);
          if (endX !== null && endY !== null) {
            ctx.moveTo(endX * hRatio, endY * vRatio);
          }
          const forwardEnd = line.idx2 + 15;
          for (let bar = line.idx2 + 1; bar <= forwardEnd; bar += 4) {
            const x = timeScale.logicalToCoordinate(bar);
            const p = getLinePrice(line.idx1, line.p1, line.slope || 0, bar);
            const y = series.priceToCoordinate(p);
            if (x !== null && y !== null) {
              ctx.lineTo(x * hRatio, y * vRatio);
            }
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // (c) Touch Points (open circles at TRUE swing price)
          ctx.strokeStyle = lineColor;
          ctx.lineWidth = 1.5 * hRatio;
          ctx.fillStyle = this._isDark ? '#18181B' : '#FFFFFF';

          for (const touch of line.touches || []) {
            const tx = timeScale.logicalToCoordinate(touch.idx);
            const ty = series.priceToCoordinate(touch.price);
            if (tx !== null && ty !== null) {
              const px = tx * hRatio;
              const py = ty * vRatio;
              ctx.beginPath();
              ctx.arc(px, py, 3.5 * hRatio, 0, 2 * Math.PI);
              ctx.fill();
              ctx.stroke();
            }
          }
        }
      }

      // 4. Draw Event Glyphs (if enabled)
      if (this._layers.breakoutRetest && pat.events) {
        for (const ev of pat.events) {
          const ex = timeScale.logicalToCoordinate(ev.idx);
          const ey = series.priceToCoordinate(ev.price);
          if (ex === null || ey === null) continue;
          const px = ex * hRatio;
          const py = ey * vRatio;

          if (ev.type === 'breakout' || ev.type === 'breakdown') {
            // Filled dot
            ctx.fillStyle = ev.type === 'breakout' ? '#059669' : '#E11D48';
            ctx.beginPath();
            ctx.arc(px, py, 4.5 * hRatio, 0, 2 * Math.PI);
            ctx.fill();
          } else if (ev.type === 'retest') {
            // Ring
            ctx.strokeStyle = '#F59E0B';
            ctx.lineWidth = 2 * hRatio;
            ctx.beginPath();
            ctx.arc(px, py, 4.5 * hRatio, 0, 2 * Math.PI);
            ctx.stroke();
          } else if (ev.type === 'close_back_inside') {
            // Cross
            ctx.strokeStyle = '#71717A';
            ctx.lineWidth = 2 * hRatio;
            const r = 3.5 * hRatio;
            ctx.beginPath();
            ctx.moveTo(px - r, py - r);
            ctx.lineTo(px + r, py + r);
            ctx.moveTo(px + r, py - r);
            ctx.lineTo(px - r, py + r);
            ctx.stroke();
          }
        }
      }
    }
  }
}
