import type { Metadata } from "next";
import { Inter, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "DocProcessor – Smart Document Processing",
  description: "Extract, validate and review business documents with AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${geistMono.variable} dark h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground selection:bg-primary/20 selection:text-foreground">
        <div className="pointer-events-none fixed inset-0 -z-10 bg-[radial-gradient(1200px_circle_at_20%_0%,oklch(0.62_0.18_270_/_0.25),transparent_55%),radial-gradient(1000px_circle_at_80%_20%,oklch(0.65_0.18_190_/_0.14),transparent_50%),radial-gradient(900px_circle_at_50%_100%,oklch(0.7_0.17_340_/_0.10),transparent_45%)]" />
        {children}
      </body>
    </html>
  );
}
