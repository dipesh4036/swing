/**
 * Pattern Explanation and Summary Generator
 * Generates neutral, factual descriptions of detected chart geometry.
 * STRICTLY avoids any evaluative, advisory, or advisory-adjacent vocabulary.
 * Prohibited words: buy, sell, target, stop, entry, signal, score, probability, guaranteed.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Formats YYYY-MM-DD into "D Mon YYYY" (e.g., "20 Nov 2026").
 * @param {string} dateStr
 * @returns {string}
 */
export function formatPatternDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const monthIdx = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const mon = MONTHS[monthIdx] || parts[1];
  return `${day} ${mon} ${year}`;
}

/**
 * Generates factual rule text and summary for a pattern.
 * @param {object} pattern
 * @returns {{ summary: string, rule_text: string }}
 */
export function describePattern(pattern) {
  const { type, metrics, window, status } = pattern;
  const startFmt = formatPatternDate(window.start_date);
  const endFmt = formatPatternDate(window.end_date);
  const foundFmt = formatPatternDate(window.found_date);

  const atrBeyond = metrics.atr_beyond;
  const absAtr = Math.abs(atrBeyond);
  const positionText = atrBeyond >= 0
    ? `${absAtr.toFixed(2)} ATR above the line`
    : `${absAtr.toFixed(2)} ATR below the line`;

  let statusPhrase = 'The last candle closed';
  if (status === 'at_line') {
    statusPhrase = 'The last candle is testing the boundary and closed';
  } else if (status === 'broke_out' || status === 'broke_down') {
    statusPhrase = 'Following a breakout bar, the last candle closed';
  }

  const summary = `Pattern ${startFmt} to ${endFmt}, found ${foundFmt}. ${statusPhrase} ${positionText}.`;

  let rule_text = '';
  switch (type) {
    case 'horizontal_ceiling':
      rule_text = 'Horizontal ceiling formed by clustered swing highs within 0.35 ATR tolerance. Requires at least two touches separated by five or more bars without earlier piercing.';
      break;
    case 'horizontal_floor':
      rule_text = 'Horizontal floor formed by clustered swing lows within 0.35 ATR tolerance. Requires at least two touches separated by five or more bars without earlier piercing.';
      break;
    case 'sloped_resistance':
      rule_text = 'Down-sloping or up-sloping boundary anchored across confirmed swing highs. Maximum slope limited to one percent per bar in logarithmic price space.';
      break;
    case 'sloped_support':
      rule_text = 'Down-sloping or up-sloping boundary anchored across confirmed swing lows. Maximum slope limited to one percent per bar in logarithmic price space.';
      break;
    case 'ascending_triangle':
      rule_text = 'Horizontal upper ceiling combined with rising lower support line. Boundaries converge with end width sixty percent or less of start width.';
      break;
    case 'descending_triangle':
      rule_text = 'Horizontal lower floor combined with declining upper resistance line. Boundaries converge with end width sixty percent or less of start width.';
      break;
    case 'symmetrical_triangle':
      rule_text = 'Declining upper resistance line converging with rising lower support line. Boundaries converge with end width sixty percent or less of start width.';
      break;
    case 'base_pivot':
      rule_text = 'Prior upward price movement of at least twenty percent followed by consolidation lasting five to forty bars with maximum pullback depth of thirty-five percent.';
      break;
    default:
      rule_text = 'Technical boundary connecting confirmed price extrema.';
      break;
  }

  return { summary, rule_text };
}
