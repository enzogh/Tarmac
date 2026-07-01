import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef5ff',
          100: '#d9e8ff',
          200: '#b9d4ff',
          300: '#8abaff',
          400: '#5696ff',
          500: '#3a7bff',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
          950: '#0b1538',
        },
        surface: {
          50: '#f8fbff',
          100: '#eef3ff',
          200: '#d9e2ff',
          300: '#b8c7f5',
          400: '#7d8fc9',
          500: '#46567f',
          600: '#2b3554',
          700: '#1f2740',
          800: '#161c30',
          900: '#0f1424',
          950: '#090d18',
        },
        slate: {
          925: '#111827',
          875: '#1a202c',
        },
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(59, 130, 246, 0.15), 0 18px 50px rgba(15, 23, 42, 0.45)',
        panel: '0 10px 35px rgba(2, 6, 23, 0.35)',
        insetSoft: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      },
      backgroundImage: {
        'radial-premium':
          'radial-gradient(circle at top, rgba(37, 99, 235, 0.22), transparent 35%), radial-gradient(circle at right, rgba(168, 85, 247, 0.16), transparent 28%), linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 1))',
        'panel-glow':
          'linear-gradient(135deg, rgba(37, 99, 235, 0.18), rgba(168, 85, 247, 0.12), rgba(14, 165, 233, 0.08))',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'float-soft': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out',
        'float-soft': 'float-soft 6s ease-in-out infinite',
        shimmer: 'shimmer 1.8s linear infinite',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
      },
    },
  },
  plugins: [],
};

export default config;
