import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#172026",
        reef: "#0f766e",
        coral: "#e85d4f",
        gold: "#c8902f",
        mist: "#f5f7f8",
      },
    },
  },
  plugins: [],
};

export default config;
