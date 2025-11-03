/** Tailwind configuration
 * Dark mode is driven by the presence of the 'dark' class on <html> (set by ThemeService).
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{html,ts}',
    './electron/**/*.ts'
  ],
  theme: {
    extend: {}
  },
  plugins: []
};
