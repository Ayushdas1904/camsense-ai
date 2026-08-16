/**
 * CamSense AI design system.
 *
 * A dark, high-contrast, data-focused enterprise theme. Colors are semantic:
 * status colors (safe/critical/warning/info) carry meaning, so use them by
 * name (`text-critical`, `bg-safe/10`) rather than raw hex values in components.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surface hierarchy (background → panels → raised elements).
        base: '#0A0E14',
        surface: '#0F1620',
        panel: '#141D29',
        raised: '#1A2536',
        border: '#22303F',
        'border-strong': '#2E3F52',

        // Text hierarchy.
        content: {
          DEFAULT: '#E6ECF3',
          muted: '#93A1B3',
          faint: '#5E6C7E',
        },

        // Brand (AI activity / primary actions).
        brand: {
          DEFAULT: '#3B82F6',
          hover: '#2F6FE0',
          soft: '#1D3A66',
        },

        // Semantic status colors.
        safe: '#22C55E',
        critical: '#EF4444',
        warning: '#F59E0B',
        info: '#3B82F6',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      borderRadius: {
        lg: '0.625rem',
      },
      boxShadow: {
        panel: '0 1px 2px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.3)',
      },
    },
  },
  plugins: [],
};
