import type { Metadata, Viewport } from "next";
import "./globals.css";
import ServiceWorker from "@/components/service-worker";
export const metadata: Metadata = {
  title: "Finance Intelligence | Sua vida financeira, em perspectiva",
  description: "Central pessoal de gestão, previsão e inteligência financeira.",
  appleWebApp: { capable: true, title: "Finance", statusBarStyle: "default" },
  icons: {
    icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};
// Nesta versão do Next, themeColor fica no export viewport (não em metadata).
export const viewport: Viewport = { themeColor: "#122f29" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head><link rel="stylesheet" href="/fonts/fonts.css" /></head>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
