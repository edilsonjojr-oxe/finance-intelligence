import type { MetadataRoute } from "next";

// Cores de globals.css: --bg (#f5f7f5) no fundo de abertura e --sidebar (#122f29) na barra.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Finance Intelligence",
    short_name: "Finance",
    description: "Central pessoal de gestão, previsão e inteligência financeira.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
    background_color: "#f5f7f5",
    theme_color: "#122f29",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
