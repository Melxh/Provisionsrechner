/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: { 700: '#12376b', 800: '#0b2545', 900: '#071a33' },
        teal: { 50: '#e8f8f7', 100: '#c7efec', 500: '#14a59c', 600: '#0f8a82', 700: '#0c6e68' },
        anthracite: { 600: '#454b55', 700: '#363b44', 800: '#2b2f36' },
        violet: { 100: '#ece9fb', 500: '#7c6bd6', 600: '#6757c2' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'] },
    },
  },
  plugins: [],
};
