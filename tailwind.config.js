/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './sidepanel.html', './pdf-translate.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          bg: 'rgb(var(--paper-bg-rgb) / <alpha-value>)',
          card: 'rgb(var(--paper-card-rgb) / <alpha-value>)',
          border: 'rgb(var(--paper-border-rgb) / <alpha-value>)',
          ink: 'rgb(var(--paper-ink-rgb) / <alpha-value>)',
          muted: 'rgb(var(--paper-muted-rgb) / <alpha-value>)',
          gold: 'rgb(var(--paper-gold-rgb) / <alpha-value>)',
          goldsoft: 'rgb(var(--paper-goldsoft-rgb) / <alpha-value>)',
          goldbg: 'rgb(var(--paper-goldbg-rgb) / <alpha-value>)',
          goldborder: 'rgb(var(--paper-goldborder-rgb) / <alpha-value>)',
          goldtext: 'rgb(var(--paper-goldtext-rgb) / <alpha-value>)',
        },
      },
      fontFamily: {
        sans: [
          'Inter',
          'PingFang SC',
          'Noto Sans SC',
          'Hiragino Sans GB',
          'Microsoft YaHei',
          '-apple-system',
          'BlinkMacSystemFont',
          'sans-serif',
        ],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        paper: '0 1px 2px rgba(28, 25, 23, 0.04), 0 8px 24px rgba(28, 25, 23, 0.06)',
        float: '0 12px 40px rgba(28, 25, 23, 0.14), 0 2px 8px rgba(28, 25, 23, 0.08)',
      },
    },
  },
  plugins: [],
};
