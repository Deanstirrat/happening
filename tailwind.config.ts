import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surfaces — Tertiary #121212 / Neutral #080808
        "background": "#121212",
        "on-background": "#e9e5d8",
        "surface": "#121212",
        "surface-dim": "#0d0d0d",
        "surface-bright": "#2c2c2c",
        "surface-container-lowest": "#080808",
        "surface-container-low": "#161616",
        "surface-container": "#1c1c1c",
        "surface-container-high": "#242424",
        "surface-container-highest": "#2e2e2e",
        "surface-variant": "#2a2a2a",
        "on-surface": "#e9e5d8",
        "on-surface-variant": "#b3aea0",
        "inverse-surface": "#e9e5d8",
        "inverse-on-surface": "#1a1a1a",
        "outline": "#6e6e6e",
        "outline-variant": "#3a3a3a",
        // Primary — #FF0000
        "primary": "#ff0000",
        "on-primary": "#ffffff",
        "primary-container": "#7a0000",
        "on-primary-container": "#ffdad6",
        "primary-fixed": "#ffdad6",
        "primary-fixed-dim": "#ff5a52",
        "on-primary-fixed": "#2c0000",
        "on-primary-fixed-variant": "#a30000",
        "inverse-primary": "#ff5449",
        "surface-tint": "#ff0000",
        // Secondary — #E9E5D8 (cream)
        "secondary": "#e9e5d8",
        "on-secondary": "#1a1a1a",
        "secondary-container": "#e9e5d8",
        "on-secondary-container": "#1a1a1a",
        "secondary-fixed": "#e9e5d8",
        "secondary-fixed-dim": "#cfcabb",
        "on-secondary-fixed": "#1a1a1a",
        "on-secondary-fixed-variant": "#4a4640",
        // Tertiary — #121212 (dark neutral)
        "tertiary": "#121212",
        "on-tertiary": "#e9e5d8",
        "tertiary-container": "#1c1c1c",
        "on-tertiary-container": "#e9e5d8",
        "tertiary-fixed": "#2a2a2a",
        "tertiary-fixed-dim": "#1c1c1c",
        "on-tertiary-fixed": "#e9e5d8",
        "on-tertiary-fixed-variant": "#b3aea0",
        // Error
        "error": "#ffb4ab",
        "on-error": "#690005",
        "error-container": "#93000a",
        "on-error-container": "#ffdad6",
      },
      fontFamily: {
        headline: ["Plus Jakarta Sans", "sans-serif"],
        body: ["Plus Jakarta Sans", "sans-serif"],
        label: ["Space Grotesk", "sans-serif"],
      },
      borderRadius: {
        DEFAULT: "1rem",
        lg: "2rem",
        xl: "3rem",
        full: "9999px",
      },
      backgroundImage: {
        "primary-gradient": "linear-gradient(135deg, #ff3b30, #ff0000)",
      },
    },
  },
  plugins: [],
};

export default config;
