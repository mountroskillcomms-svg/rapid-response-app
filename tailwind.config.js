/** @type {import('tailwindcss').Config} */
export default {
  // Every place a Tailwind class can appear, so the build generates all of
  // them. Previously styles came from the Play CDN (cdn.tailwindcss.com),
  // which compiled in the browser at runtime and dropped utilities on a
  // large app; this build generates a complete, deterministic stylesheet.
  content: [
    './index.html',
    './src/**/*.{js,jsx,ts,tsx}',
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}
