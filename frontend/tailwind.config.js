/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'risk-critical': '#ef4444',
        'risk-high': '#f97316',
        'risk-medium': '#f59e0b',
        'risk-low': '#22c55e',
        'risk-insufficient': '#9ca3af',
      },
    },
  },
  plugins: [],
}
