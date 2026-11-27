/**
 * Centralized Design System Tokens
 * Single source of truth for colors, typography, spacing, radius, and shadows.
 */

export const TOKENS = {
  colors: {
    // Brand & Primary — Electric Indigo
    primary: "#4F46E5",
    primaryHover: "#4338CA",
    primarySubtle: "#EEF2FF",
    primaryBorder: "#C7D2FE",

    // Background surfaces — Cool Zinc Canvas
    bgMain: "#FAFAFA",
    bgSecondary: "#F4F4F5",
    bgCard: "#FFFFFF",
    bgHover: "#EBEBEF",
    bgSelected: "#EEF2FF",

    // Text & Typography
    textPrimary: "#18181B",
    textSecondary: "#52525B",
    textMuted: "#71717A",
    textDisabled: "#D4D4D8",
    textInverse: "#FFFFFF",

    // Market status (Indian Equities High-Contrast Financial Conventions)
    bullish: "#047857",
    bullishBg: "#ECFDF5",
    bullishBorder: "#A7F3D0",

    bearish: "#BE123C",
    bearishBg: "#FFF1F2",
    bearishBorder: "#FECDD3",

    neutral: "#52525B",
    neutralBg: "#F4F4F5",
    neutralBorder: "#E4E4E7",

    warning: "#B45309",
    warningBg: "#FFFBEB",
    warningBorder: "#FDE68A",

    info: "#4F46E5",
    infoBg: "#EEF2FF",
    infoBorder: "#C7D2FE",

    // Borders — 1px Flat Precise
    border: "#E4E4E7",
    borderSubtle: "#F4F4F5",
    borderStrong: "#D4D4D8",
    borderFocus: "#4F46E5",

    // Market Cap & Index Specific
    largeCap: "#4F46E5",
    midCap: "#F97316",
    smallCap: "#059669",
    benchmark: "#A1A1AA",
  },

  typography: {
    fontFamily: {
      sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      mono: "'JetBrains Mono', ui-monospace, Menlo, Monaco, Consolas, monospace",
    },

    // Strict typography scale with line-height & letter-spacing
    scale: {
      xs: { fontSize: "11px", lineHeight: "16px", letterSpacing: "0.01em" }, // Axis ticks & as-of timestamps only
      sm: { fontSize: "12px", lineHeight: "16px", letterSpacing: "-0.01em" }, // Minimum informational text
      base: { fontSize: "13px", lineHeight: "18px", letterSpacing: "-0.01em" },
      md: { fontSize: "14px", lineHeight: "20px", letterSpacing: "-0.015em" },
      lg: { fontSize: "16px", lineHeight: "22px", letterSpacing: "-0.02em" },
      xl: { fontSize: "18px", lineHeight: "24px", letterSpacing: "-0.02em" },
      "2xl": { fontSize: "22px", lineHeight: "28px", letterSpacing: "-0.025em" },
      "3xl": { fontSize: "26px", lineHeight: "32px", letterSpacing: "-0.03em" },
    },

    // Weights
    weight: {
      regular: 400,
      medium: 500,
      semibold: 600,
      bold: 700,
    },

    // Semantic text roles
    roles: {
      pageTitle: {
        fontFamily: "sans",
        fontSize: "15px",
        fontWeight: 700,
        lineHeight: "18px",
        letterSpacing: "-0.02em",
        color: "#18181B",
      },
      sectionTitle: {
        fontFamily: "sans",
        fontSize: "12px",
        fontWeight: 700,
        lineHeight: "16px",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "#18181B",
      },
      cardHeading: {
        fontFamily: "sans",
        fontSize: "13px",
        fontWeight: 700,
        lineHeight: "18px",
        letterSpacing: "-0.01em",
        color: "#18181B",
      },
      metricDisplay: {
        fontFamily: "sans",
        fontSize: "22px",
        fontWeight: 700,
        lineHeight: "26px",
        letterSpacing: "-0.025em",
        tabularNums: true,
        color: "#18181B",
      },
      body: {
        fontFamily: "sans",
        fontSize: "12px",
        fontWeight: 400,
        lineHeight: "16px",
        color: "#71717A",
      },
      labelCaps: {
        fontFamily: "sans",
        fontSize: "11px",
        fontWeight: 600,
        lineHeight: "14px",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        color: "#71717A",
      },
      footnote: {
        fontFamily: "sans",
        fontSize: "10px",
        fontWeight: 500,
        lineHeight: "14px",
        color: "#A1A1AA",
      },
      tableNumeral: {
        fontFamily: "sans",
        fontSize: "12px",
        fontWeight: 600,
        tabularNums: true,
        color: "#18181B",
      },
    },
  },

  spacing: {
    1: "4px",
    2: "8px",
    3: "12px",
    4: "16px",
    5: "20px",
    6: "24px",
    8: "32px",
    10: "40px",
    12: "48px",
  },

  radius: {
    xs: "2px",
    sm: "4px",
    md: "6px",
    lg: "8px",
    xl: "12px",
    full: "9999px",
  },

  shadows: {
    none: "none",
    subtle: "none",
    sm: "none",
    md: "none",
  },
};

export default TOKENS;
