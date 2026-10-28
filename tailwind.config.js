/** Tailwind configuration
 * Dark mode is driven by the presence of the 'dark' class on <html> (set by ThemeService).
 */
const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const channelScale = (name) =>
  Object.fromEntries(SHADES.map((shade) => [shade, `rgb(var(--${name}-${shade}) / <alpha-value>)`]));

/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './src/**/*.{html,ts}',
    './electron/**/*.ts'
  ],
  theme: {
    extend: {
      colors: {
        // Jyske Bank CVI: neutrals and the accent are CSS-variable driven (see src/styles.scss),
        // so existing slate-*/indigo-* utilities follow the light and dark themes.
        slate: channelScale('slate'),
        indigo: channelScale('accent'),
        cvi: {
          morkegron: '#00422E',
          lysegron: '#ECFBDB',
          sand: '#FAF6F0',
          bladgron: '#A0D169',
          lavendel: '#B5B8F7',
          guld: '#C3B092',
          fersken: '#FFC6B2',
          koral: '#F77A5C',
          brun: '#61442F',
          gul: '#FFCF5F',
          bordeaux: '#80263B',
          rosa: '#FAE5DC',
          morkelilla: '#453987',
          himmelbla: '#EBECFA',
          mellemgron: '#3D856C'
        }
      }
    }
  },
  plugins: []
};
