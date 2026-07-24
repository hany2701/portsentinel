import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Tailwind is given an EXPLICIT config path resolved from this file.
//
// With a bare `tailwindcss: {}` it searches for tailwind.config.js starting at
// the process working directory. Any launcher that starts Vite from outside the
// project folder therefore finds no config, falls back to defaults with an empty
// `content` array, and emits "The `content` option ... is missing or empty" —
// serving a stylesheet with no utilities, so the whole app renders unstyled
// while `npm run build` (run from the project root) looks perfectly fine.
const root = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: join(root, "tailwind.config.js") },
    autoprefixer: {},
  },
};
