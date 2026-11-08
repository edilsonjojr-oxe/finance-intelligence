import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorker from "@/components/service-worker";

// Fontes do design system, servidas pelo próprio app (sem requisição a terceiros no navegador).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-jb", display: "swap", weight: ["400", "500"] });
export const metadata: Metadata = {
  title: "Finance Intelligence | Suas finanças em um só lugar",
  description: "Saldos, cartões, compromissos e projeções em um só lugar. Importe faturas e extratos com revisão antes de salvar.",
  openGraph: { title: "Finance Intelligence", description: "Saldos, cartões, compromissos e projeções em um só lugar.", locale: "pt_BR", type: "website" },
  robots: { index: false, follow: false },
  appleWebApp: { capable: true, title: "Finance", statusBarStyle: "black" },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/icons/icon-192-v2.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/apple-touch-icon-v2.png", sizes: "180x180", type: "image/png" }],
  },
};
// Nesta versão do Next, themeColor fica no export viewport (não em metadata).
export const viewport: Viewport = { themeColor: "#000000", colorScheme: "dark" };
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className={`${inter.variable} ${mono.variable}`}>
      <body>
        {children}
        <ServiceWorker />
      </body>
    </html>
  );
}
