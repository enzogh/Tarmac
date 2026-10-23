import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        // Three raised surfaces: page < card < inset panel inside a card.
        // Depth in this UI comes from these steps, not from shadows.
        surface: {
          1: 'hsl(var(--surface-1))',
          2: 'hsl(var(--surface-2))',
          3: 'hsl(var(--surface-3))',
        },
        // Semantic status, one hue per meaning everywhere in the app.
        ok: 'hsl(var(--ok))',
        warn: 'hsl(var(--warn))',
        danger: 'hsl(var(--danger))',
        info: 'hsl(var(--info))',
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
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        xl: 'calc(var(--radius) + 2px)',
        '2xl': 'calc(var(--radius) + 4px)',
        '3xl': 'calc(var(--radius) + 8px)',
      },
      boxShadow: {
        // Shadows only ever lift something that genuinely floats above the
        // page (menus, dialogs, the mobile drawer). Cards use a border.
        glow: '0 0 0 1px hsl(var(--primary) / 0.25)',
        panel: '0 1px 2px rgba(0, 0, 0, 0.4)',
        overlay: '0 16px 48px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)',
        insetSoft: 'inset 0 1px 0 rgba(255, 255, 255, 0.04)',
      },
      fontSize: {
        // One step below Tailwind's xs, for table meta and chart axes -
        // previously written as ad-hoc text-[11px] in ~80 places.
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      backgroundImage: {
        'radial-premium':
          'radial-gradient(circle at top, rgba(37, 99, 235, 0.22), transparent 35%), radial-gradient(circle at right, rgba(168, 85, 247, 0.16), transparent 28%), linear-gradient(180deg, rgba(15, 23, 42, 0.96), rgba(2, 6, 23, 1))',
        // Kept as a no-op gradient so the ~20 existing `bg-panel-glow`
        // call sites stay valid while cards move to a flat surface.
        'panel-glow': 'none',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        gradient: {
          to: { backgroundPosition: 'var(--bg-size) 0' },
        },
        rainbow: {
          '0%': { 'background-position': '0%' },
          '100%': { 'background-position': '200%' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 220ms ease-out',
        shimmer: 'shimmer 1.8s linear infinite',
        gradient: 'gradient 8s linear infinite',
        rainbow: 'rainbow var(--speed, 2s) infinite linear',
      },
    },
  },
  plugins: [],
};

export default config;
