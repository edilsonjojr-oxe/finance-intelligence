import type { MetadataRoute } from "next";

// Cores de globals.css: --bg (#111111) no fundo de abertura e --sidebar (#000000) na barra.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance Intelligence",
    short_name: "Finance",
    description: "Central pessoal de gestão, previsão e inteligência financeira.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    background_color: "#111111",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192-v2.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512-v2.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512-v2.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
