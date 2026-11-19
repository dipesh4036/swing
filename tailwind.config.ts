import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Minimalist Flat Canvas Tokens — maps directly to CSS variables */
        bg: "var(--color-bg)",
        "bg-page": "var(--color-bg-page)",
        "bg-card": "var(--color-bg-card)",
        "bg-secondary": "var(--color-bg-secondary)",
        "bg-hover": "var(--color-bg-hover)",
        "bg-selected": "var(--color-bg-selected)",

        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        "surface-3": "var(--color-surface-3)",
        "surface-inset": "var(--color-surface-inset)",

        border: "var(--color-border)",
        "border-subtle": "var(--color-border-subtle)",
        "border-strong": "var(--color-border-strong)",

        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-subtle": "var(--color-primary-subtle)",

        accent: "var(--color-accent)",
        "accent-hover": "var(--color-accent-hover)",
        "accent-tint": "var(--color-accent-tint)",
        "accent-border": "var(--color-accent-border)",

        text: "var(--color-text)",
        "text-primary": "var(--color-text-primary)",
        "text-secondary": "var(--color-text-secondary)",
        "text-muted": "var(--color-text-muted)",
        "text-faint": "var(--color-text-faint)",
        "text-inverse": "var(--color-text-inverse)",

        bullish: "var(--color-bullish)",
        "bullish-bg": "var(--color-bullish-bg)",
        "bullish-border": "var(--color-bullish-border)",
        up: "var(--color-up)",
        "up-text": "var(--color-up-text)",

        bearish: "var(--color-bearish)",
        "bearish-bg": "var(--color-bearish-bg)",
        "bearish-border": "var(--color-bearish-border)",
        down: "var(--color-down)",
        "down-text": "var(--color-down-text)",

        neutral: "var(--color-neutral)",
        "neutral-bg": "var(--color-neutral-bg)",
        warning: "var(--color-warning)",
        "warning-bg": "var(--color-warning-bg)",

        stale: "var(--color-stale)",
        "stale-text": "var(--color-stale-text)",
        "stale-bg": "var(--color-stale-bg)",
        info: "var(--color-info)",
        "info-text": "var(--color-info-text)",

        /* Dynamic terminal-* aliases for full dual-theme support */
        terminal: {
          bg: "var(--color-bg)",
          card: "var(--color-surface)",
          cardHover: "var(--color-bg-hover)",
          border: "var(--color-border)",
          subtle: "var(--color-border-subtle)",
          text: "var(--color-text-primary)",
          muted: "var(--color-text-secondary)",
          bull: "var(--color-bullish)",
          bear: "var(--color-bearish)",
          accent: "var(--color-accent)",
          gold: "var(--color-warning)",
        },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "BlinkMacSystemFont", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      height: {
        topbar: "var(--shell-topbar-h)",
      },
      width: {
        rail: "var(--shell-rail-w)",
      },
    },
  },
  plugins: [],
};

export default config;
