/** @type {import('tailwindcss').Config} */
// Identidad: gris grafito #1F2933, naranja de seguridad #F26B1D (solo conflictos y atrasos),
// fondo #F4F5F7, blanco #FFFFFF y acentos por área #3E7CB1 · #2F9E6E · #8E5BB5.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        grafito: {
          50: '#F4F5F7', 100: '#E9ECEF', 200: '#D9DEE3', 300: '#BCC4CC', 400: '#8A95A1',
          500: '#66717D', 600: '#4B5561', 700: '#36404B', 800: '#2A333D', 900: '#1F2933', 950: '#151C24',
        },
        alerta: { DEFAULT: '#F26B1D', claro: '#B4500F', fondo: '#FDEEE4' },
        azul: '#3E7CB1',
        verde: '#2F9E6E',
        violeta: '#8E5BB5',
      },
      fontFamily: {
        sans: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
        cond: ['Oswald', '"Source Sans 3"', 'sans-serif'],
        mono: ['"Source Sans 3"', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
