import type { Metadata } from "next";
import { Assistant } from "next/font/google";
import "./globals.css";

const font = Assistant({ subsets: ["hebrew", "latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "המזכירה — Executive Assistant",
  description: "עוזרת אישית מבוססת AI: משימות, אישורים, מיילים, יומן, זיכרון ומרכז פעילות.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={`${font.variable} dark`} suppressHydrationWarning>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
