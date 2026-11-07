import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Finance Intelligence | Sua vida financeira, em perspectiva",
  description: "Central pessoal de gestão, previsão e inteligência financeira.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <head><link rel="stylesheet" href="/fonts/fonts.css" /></head>
      <body>{children}</body>
    </html>
  );
}
