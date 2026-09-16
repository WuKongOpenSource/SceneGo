/** @type {import('tailwindcss').Config} */



const violet = {
  50: '#ECE9FF', 100: '#E3DEFF', 200: '#D9D2FF', 300: '#B7A4FF', 400: '#8B6BFF',
  500: '#5B49F0', 600: '#4C3BD6', 700: '#4536C9', 800: '#372CA1', 900: '#2A2179', 950: '#1A1550',
};
const warmNeutral = {
  50: '#FBFBF9', 100: '#F4F4F1', 200: '#E5E5E0', 300: '#D2D2CA', 400: '#9A9AA2',
  500: '#6A6A74', 600: '#4A4A54', 700: '#3A3A44', 800: '#26262E', 900: '#17171C', 950: '#141419',
};
const successGreen = {
  50: '#E4F7EE', 100: '#C9EEDC', 200: '#8FDDB8', 300: '#3FCB8F', 400: '#26C17D',
  500: '#12B76A', 600: '#0E9455', 700: '#0A7143', 800: '#075C36', 900: '#05432A', 950: '#032818',
};
const brandOrange = {
  50: '#FFF0EB', 100: '#FFD9C9', 200: '#FFB694', 300: '#FF9A6B', 400: '#FF8253',
  500: '#FF6A3D', 600: '#E0512A', 700: '#B8401F', 800: '#8F3116', 900: '#66220E', 950: '#3D1408',
};
const infoBlue = {
  50: '#E6F0FF', 100: '#CCE0FF', 200: '#99C2FF', 300: '#66A0F5', 400: '#4A8CEC',
  500: '#3B7BE5', 600: '#2C60BC', 700: '#204893', 800: '#18366E', 900: '#10244A', 950: '#0A1730',
};
const dangerRed = {
  50: '#FFEBE6', 100: '#FFD4CA', 200: '#FFA894', 300: '#F57D63', 400: '#F06A50',
  500: '#E5533C', 600: '#C43C27', 700: '#9C2E1D', 800: '#7A2416', 900: '#5C1A10', 950: '#380F09',
};
const violet2 = {
  50: '#F0EEFF', 100: '#DED6FF', 200: '#C3B3FF', 300: '#9F83FF', 400: '#8B6BFF',
  500: '#7A5BFF', 600: '#6446E0', 700: '#4E35B5', 800: '#3E2A91', 900: '#2E1F6D', 950: '#1C1342',
};
const amber = {
  50: '#FFF6E5', 100: '#FFE9C2', 200: '#FFD58A', 300: '#F5C063', 400: '#F0A94F',
  500: '#D9822B', 600: '#B4681F', 700: '#8A4E16', 800: '#6B3C10', 900: '#4A2A0B', 950: '#2E1A06',
};

module.exports = {
  content: [
    './index.html',
    './App.tsx',
    './main.tsx',
    './components/**/*.{ts,tsx}',
    './platform/**/*.{ts,tsx}',
    './services/**/*.{ts,tsx}',
    '../deploy/new_html/components/ModelPicker.tsx',
    '../deploy/new_html/components/SeedreamSourceBadge.tsx',
  ],
  theme: {
    extend: {
      colors: {
        n0: '#FFFFFF', n20: '#F4F4F1', n30: '#F0F0EC', n40: '#E5E5E0',
        n100: '#9A9AA2', n300: '#6A6A74', n700: '#22222B', n800: '#17171C', n900: '#141419',
        p50: '#F0EEFF', p75: '#DED6FF',
        cyan: violet,
        sky: violet,
        blue: violet,
        slate: warmNeutral,
        zinc: warmNeutral,
        emerald: successGreen,
        green: successGreen,
        pink: brandOrange,
        orange: brandOrange,
        teal: infoBlue,
        red: dangerRed,
        rose: dangerRed,
        purple: violet2,
        indigo: violet2,
        amber,
        yellow: amber,
        primary: {
          DEFAULT: '#5B49F0',
          hover: '#4C3BD6',
          active: '#4536C9',
          light: '#ECE9FF',
        },
      },
      fontFamily: {
        sans: ['Noto Sans SC', 'Sora', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        display: ['Sora', 'Noto Sans SC', 'PingFang SC', 'Microsoft YaHei', 'sans-serif'],
        mono: ['Space Mono', 'Inconsolata', 'ui-monospace', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      animation: {
        'in': 'studio-in 180ms ease-out both',
      },
      boxShadow: {
        bottom: '0 24px 70px rgba(20,20,25,0.18)',
      },
      keyframes: {
        'studio-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
