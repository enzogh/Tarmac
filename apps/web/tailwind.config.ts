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
        slate: {
          950: '#0f172a',
          925: '#111827',
          900: '#0f172a',
          875: '#1a202c',
        },
      },
    },
  },
  plugins: [],
};

export default config;
