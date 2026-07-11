import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
          elevated: "hsl(var(--card-elevated))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        border: "hsl(var(--border) / 0.12)",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        electric: {
          DEFAULT: "#18BFFF",
          muted: "hsl(var(--electric-muted))",
        },
        signal: {
          DEFAULT: "#20E6A8",
          muted: "hsl(var(--signal-muted))",
        },
        violet: {
          DEFAULT: "#7C5CFF",
        },
        warning: "#F5B942",
        danger: "#FF5C6C",
        panel: "hsl(var(--panel))",
        secondary: "#9BAAC2",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      animation: {
        "pulse-subtle": "pulse-subtle 2s ease-in-out infinite",
        "cursor-blink": "cursor-blink 1s step-end infinite",
      },
      keyframes: {
        "pulse-subtle": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.6" },
        },
        "cursor-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
      boxShadow: {
        "mcc-glow": "0 0 32px rgba(24, 168, 255, 0.1)",
        "artifact-hover": "0 0 24px rgba(24, 168, 255, 0.08)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
