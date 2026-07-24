import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import defaultTheme from "tailwindcss/defaultTheme";

// Content globs are resolved against THIS FILE, not the working directory.
// Relative globs ("./src/**") silently match nothing when the dev server is
// launched from anywhere other than the project root — Tailwind then emits
// "content option is missing or empty" and serves a stylesheet with no
// utilities, so the app renders completely unstyled while the production build
// (run from the root) looks fine.
const root = dirname(fileURLToPath(import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [join(root, "index.html"), join(root, "src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter Variable", ...defaultTheme.fontFamily.sans],
      },
    },
  },
  plugins: [],
};
