\# Layout spec — "Resilience Monitor" dashboard

Build a React 18 \+ Vite \+ TypeScript (strict) \+ Tailwind CSS v3 app using this exact  
layout and design system. Dark mode is via Tailwind \`class\` strategy.

\#\# Hard rules  
\- NO emoji anywhere (UI, code, comments, commits). Enterprise ops tool.  
\- Icons: \`lucide-react\` only. No glyph characters as icons.  
\- Every displayed value shows a provenance tag via one \<SourceTag\> component with  
  variants: Live | Simulated | Computed | AI-generated (a small colored dot \+ text label).  
\- Every panel handles loading / empty / error / stale states explicitly — never blank.  
\- Dark mode on all UI. Palette: slate (bg-slate-100/white light, bg-slate-950/900 dark).  
\- Charts (if any) use explicit hex per mode (Recharts/Leaflet ignore Tailwind \`dark:\`):  
  light \#2a78d6 / \#1baf7a / \#eda100, dark \#3987e5 / \#199e70 / \#c98500, danger \#d03b3b.

\#\# App shell (three regions)  
\- Left sidebar, fixed width w-60, border-r, white / dark:slate-900:  
  \- Brand block: app name \+ one-line subtitle.  
  \- Primary nav: vertical list of icon \+ label buttons. Active item \= solid  
    slate-900 (dark: slate-100) pill; inactive \= muted with hover bg.  
  \- Footer: small muted version/status line.  
\- Main column (flex-1, min-w-0):  
  \- Top header, border-b, white / dark:slate-900: left \= current view title (h1);  
    right \= a status strip \+ action buttons (demo toggle, chat toggle, dark toggle),  
    all icon buttons with aria-labels.  
  \- \<main\> scrollable, p-6.  
\- Floating layers over everything: a right-side chat drawer, a demo panel, a toast stack.

\#\# Reusable primitives  
\- Panel: rounded-lg border bg-white/dark:slate-900 p-4 shadow-sm; header row with a  
  text-sm font-semibold title on the left and optional actions on the right; mt-3 body.  
  Also export PanelState({text}) — a text-sm text-slate-500 line for all non-loaded states.  
\- KpiCard: label (muted, small) \+ big value \+ small detail line \+ a \<SourceTag\>.  
\- SourceTag: colored dot \+ label, one component owning provenance styling.  
\- Gauge \+ Sparkline for the cockpit.

\#\# Main dashboard view layout (the "Resilience Monitor")  
Inside \`mx-auto max-w-7xl 2xl:max-w-none space-y-4\`:  
1\. KPI row: \`grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7\` — 7 KpiCards  
   (e.g. a headline resilience score \+ 6 supporting metrics).  
2\. Feature row: \`grid gap-4 xl:grid-cols-3\` — a cockpit/gauge panel (1 col) beside a  
   larger schematic/overview panel (\`xl:col-span-2\`).  
3\. Controls row: \`grid gap-4 xl:grid-cols-2\` — two side-by-side panels  
   (e.g. scenario controls \+ a decision/optimizer panel).

\#\# Navigation  
A sidebar router with N views; keep the shell identical across views, only \<main\> swaps.  
Lazy-load any heavy chart/map views.

Match this structure, spacing scale, and dark-mode treatment exactly.