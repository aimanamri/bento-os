/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/index.html', './src/js/**/*.js'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Bento token system — every UI color routes through these
        // CSS variables so dark/light stay in lockstep (UX-SPEC §1).
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        panel: 'rgb(var(--c-panel) / <alpha-value>)',
        'panel-2': 'rgb(var(--c-panel-2) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        'ink-muted': 'rgb(var(--c-ink-muted) / <alpha-value>)',
        edge: 'rgb(var(--c-edge) / <alpha-value>)',
        accent: 'rgb(var(--c-accent) / <alpha-value>)',
        'ok-hue': 'rgb(var(--c-ok) / <alpha-value>)',
        'info-hue': 'rgb(var(--c-info) / <alpha-value>)',
        'warn-hue': 'rgb(var(--c-warn) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
      },
      borderRadius: {
        card: '0.65rem',
        frame: '1rem',
      },
      boxShadow: {
        lift: '0 8px 30px rgb(0 0 0 / 0.25)',
        card: '0 2px 10px rgb(0 0 0 / 0.12)',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
