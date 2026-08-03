/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--zx-brand-50)',
          100: 'var(--zx-brand-100)',
          200: 'var(--zx-brand-200)',
          300: 'var(--zx-brand-300)',
          400: 'var(--zx-brand-400)',
          500: 'var(--zx-brand-500)',
          600: 'var(--zx-brand-600)',
          700: 'var(--zx-brand-700)',
          800: 'var(--zx-brand-800)',
          900: 'var(--zx-brand-900)',
          950: 'var(--zx-brand-950)',
        },
      },
      colors: {
        // Light professional surfaces
        surface: {
          0: '#f5f3fa',   // body bg — light gray
          1: '#ffffff',   // card / panel — white
          2: '#faf9fd',   // hover / elevated
          3: '#efecf6',   // input bg / active row
          4: '#e6e1f0',   // tooltip / popover
        },
        // Primary blue (replaces lime)
        lime: {
          DEFAULT: '#7c3aed',
          dim: 'rgba(124,58,237,0.10)',
          glow: 'rgba(124,58,237,0.30)',
        },
        neon: {
          DEFAULT: '#06b6d4',
          dim: 'rgba(6,182,212,0.10)',
        },
        danger: {
          DEFAULT: '#e11d48',
          dim: 'rgba(225,29,72,0.10)',
        },
        warn: {
          DEFAULT: '#f59e0b',
          dim: 'rgba(245,158,11,0.10)',
        },
      },
      fontFamily: {
        sans:    ['Manrope', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk"', 'sans-serif'],
      },
      boxShadow: {
        'card':      '0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        'card-lg':   '0 4px 16px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.06)',
        'lime':      '0 4px 20px rgba(124,58,237,0.25)',
        'lime-lg':   '0 6px 30px rgba(124,58,237,0.35)',
        'neon':      '0 4px 20px rgba(6,182,212,0.20)',
        'modal':     '0 25px 50px -12px rgba(0,0,0,0.20)',
        'glow-lime': '0 0 12px rgba(124,58,237,0.40)',
        'inner-lime':'inset 0 0 15px rgba(124,58,237,0.15)',
      },
      backgroundImage: {
        'lime-subtle': 'linear-gradient(135deg, rgba(124,58,237,0.08) 0%, rgba(124,58,237,0.02) 100%)',
        'neon-subtle': 'linear-gradient(135deg, rgba(6,182,212,0.08) 0%, rgba(6,182,212,0.02) 100%)',
      },
      animation: {
        'pulse-lime': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
      },
      backdropBlur: {
        glass: '16px',
      },
    },
  },
  plugins: [],
}
