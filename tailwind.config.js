/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: {
          bg: '#F7F6F3',
          card: '#FFFFFF',
          border: '#E7E5E4',
          ink: '#1C1917',
          muted: '#78716C',
          gold: '#D97706',
          goldsoft: '#FEF3C7',
          goldbg: '#FFFBEB',
          goldborder: '#FDE68A',
          goldtext: '#B45309',
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
