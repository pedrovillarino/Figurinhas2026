import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://figurinhas2026.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Figurinhas Copa 2026 — Gerencie seu Álbum",
    template: "%s | Figurinhas Copa 2026",
  },
  description: "Gerencie seu álbum de figurinhas da Copa do Mundo FIFA 2026. Controle suas figurinhas, encontre trocas e complete sua coleção.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Figurinhas 2026",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Figurinhas Copa 2026",
    title: "Figurinhas Copa 2026 — Gerencie seu Álbum",
    description: "Controle suas figurinhas, encontre trocas perto de você e complete sua coleção da Copa do Mundo FIFA 2026.",
    url: APP_URL,
    images: [
      {
        url: "/album-cover.jpg",
        width: 1200,
        height: 630,
        alt: "Álbum de Figurinhas Copa do Mundo FIFA 2026",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Figurinhas Copa 2026",
    description: "Gerencie seu álbum de figurinhas da Copa do Mundo FIFA 2026.",
    images: ["/album-cover.jpg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
    },
  },
  alternates: {
    canonical: APP_URL,
  },
};

export const viewport: Viewport = {
  themeColor: "#7C3AED",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} font-sans antialiased bg-gray-50 text-gray-900`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:bg-violet-600 focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Pular para o conteudo
        </a>
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
