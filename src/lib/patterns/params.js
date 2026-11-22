/**
 * Pattern Detection Parameters
 * Single source of truth for all chart pattern detection thresholds.
 */
export const PATTERN_PARAMS = {
  // Candle History
  min_history_bars: 60,            // Minimum bars required to attempt pattern detection
  max_lookback_bars: 250,          // Maximum bars analyzed from the end of the series

  // ATR Calculation (Wilder 14)
  atr_period: 14,                  // Wilder smoothing period for True Range

  // Swing Pivots
  pivot_k: 3,                      // Number of neighbor bars on each side for local extremum
  pivot_prominence_atr: 0.5,       // Swing point must stand out by at least 0.5 ATR

  // Common Line Geometry
  touch_tol: 0.35,                 // Distance in ATR units to count a swing point as a line touch
  pierce_tol: 0.2,                 // Maximum ATR penetration of a line between anchors before breakout
  min_touches: 2,                  // Minimum number of distinct touches for a valid line
  min_bars_between_touches: 5,     // Minimum bar separation between consecutive touches
  min_span_bars: 10,               // Minimum length of pattern line in bars
  max_span_bars: 120,              // Maximum length of pattern line in bars
  max_slope_pct_per_bar: 0.01,     // Maximum slope in ln space (1.0% per bar)
  flat_drift_atr: 0.5,             // Max total drift in ATR units to classify a boundary as flat (U10)

  // Status & Event Thresholds
  at_line_atr: 0.5,                // Within 0.5 ATR of line is "at_line" (Testing)
  breakout_atr: 0.1,               // Penetration beyond line by 0.1 ATR defines a break
  retest_atr: 0.25,                // Return within 0.25 ATR of line constitutes a retest
  retest_band_half_width_atr: 0.25,// Retest band thickness in ATR units
  recent_break_bars: 10,           // Break must be within 10 bars to be active (U8)
  max_pattern_age_bars: 40,        // Max age since last touch for forming/at_line patterns (U8)

  // Triangles
  triangle_min_duration: 15,       // Minimum bars between first touch and convergence
  triangle_max_duration: 120,      // Maximum bars between first touch and convergence
  triangle_end_width_ratio: 0.6,   // Convergence requirement: end width <= 0.6 * start width

  // Base + Pivot Consolidation
  leg_min_rise_pct: 20.0,          // Prior upward thrust of at least 20%
  leg_max_bars: 60,                // Upward thrust must occur within 60 bars
  base_min_bars: 5,                // Minimum consolidation length in bars
  base_max_bars: 40,               // Maximum consolidation length in bars
  base_max_depth_pct: 35.0,        // Maximum depth: (pivot - base_low)/pivot <= 35%
  volume_avg_bars: 50,             // Simple moving average volume benchmark

  // Output Caps & Selection
  max_patterns_returned: 8,        // Maximum patterns returned per stock
  line_overlap_threshold: 0.70,    // Lines sharing >= 70% overlap are deduplicated
  forward_extension_bars: 15,      // Number of bars dashed line projects forward into future
};
