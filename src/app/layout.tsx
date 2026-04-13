import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import CookieConsent from "@/components/CookieConsent";
import { Analytics } from "@vercel/analytics/react";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://www.completeai.com.br";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "Complete Aí — Álbum de Figurinhas com IA",
    template: "%s | Complete Aí",
  },
  description: "Use IA para organizar e completar seu álbum mais fácil. Escaneie figurinhas, encontre trocas perto de você.",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Complete Aí",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Complete Aí",
    title: "Complete Aí — Álbum de Figurinhas com IA",
    description: "Escaneie suas figurinhas com IA e encontre trocas perto de você.",
    url: APP_URL,
    images: [
      {
        url: "/album-cover.jpg",
        width: 1200,
        height: 630,
        alt: "Complete Aí — Álbum de Figurinhas Digital",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Complete Aí — Álbum de Figurinhas com IA",
    description: "Use IA para organizar e completar seu álbum mais fácil.",
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
  themeColor: "#00C896",
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
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "Complete Aí",
              description: "Use IA para organizar e completar seu álbum de figurinhas mais fácil. Escaneie figurinhas com IA e encontre trocas perto de você.",
              url: "https://www.completeai.com.br",
              applicationCategory: "UtilityApplication",
              operatingSystem: "Web",
            }),
          }}
        />
      </head>
      <body className={`${inter.variable} font-sans antialiased bg-gray-50 text-navy`}>
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:bg-brand focus:text-white focus:px-4 focus:py-2 focus:rounded-lg focus:text-sm focus:font-medium focus:shadow-lg"
        >
          Pular para o conteúdo
        </a>
        {children}
        <ServiceWorkerRegister />
        <CookieConsent />
        <Analytics />
      </body>
    </html>
  );
}
