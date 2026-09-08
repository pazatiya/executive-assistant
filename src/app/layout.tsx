import type { Metadata, Viewport } from "next";
import { Assistant } from "next/font/google";
import "./globals.css";

const font = Assistant({ subsets: ["hebrew", "latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "המזכירה — DALOR",
  description: "עוזרת דיגיטלית ל-DALOR — לקוחות, תורים, תזכורות, סיכומים.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "המזכירה", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#f5f6fa",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={font.variable} suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
