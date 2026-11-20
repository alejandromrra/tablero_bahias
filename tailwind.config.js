/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Pizarrón grafito
        grafito: {
          950: '#121416', 900: '#181b1e', 850: '#1e2226', 800: '#252a2f', 700: '#323940',
          600: '#46505a', 500: '#5f6b76', 400: '#8592a0', 300: '#aab4be', 200: '#cdd4da', 100: '#e7ebee',
        },
        tiza: '#eef1f3',
        // Naranja de seguridad: SOLO conflictos y atrasos
        alerta: { DEFAULT: '#ff6a13', claro: '#ff8a45', fondo: '#3a1f0f' },
      },
      fontFamily: {
        sans: ['"Barlow"', 'system-ui', 'sans-serif'],
        cond: ['"Barlow Condensed"', '"Barlow"', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
};
