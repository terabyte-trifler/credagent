/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        cred: {
          50: '#effef7', 100: '#d9fced', 200: '#b5f8d8',
          300: '#7cf0b9', 400: '#3ce093', 500: '#14c972',
          600: '#09a55b', 700: '#0b824a', 800: '#0e663d', 900: '#0d5434',
        },
        surface: { 0: '#0a0a0f', 1: '#12121a', 2: '#1a1a26', 3: '#222233' },
      },
      fontFamily: {
        display: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      keyframes: {
        'fade-up': { '0%': { opacity: '0', transform: 'translateY(12px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
        'pulse-ring': { '0%': { boxShadow: '0 0 0 0 rgba(20,201,114,0.4)' }, '100%': { boxShadow: '0 0 0 8px rgba(20,201,114,0)' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
        'pulse-ring': 'pulse-ring 2s ease infinite',
        shimmer: 'shimmer 1.5s infinite',
      },
    },
  },
  plugins: [],
};
