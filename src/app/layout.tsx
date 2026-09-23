import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono, Unbounded } from "next/font/google";
import "./globals.css";

const body = Geist({ variable: "--font-body", subsets: ["latin"] });
const display = Unbounded({ variable: "--font-display", subsets: ["latin"], weight: ["500", "700", "800"] });
const mono = JetBrains_Mono({ variable: "--font-mono", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "ROCKET.AI — Talk a rocket into existence",
  description: "Design ridiculous fictional rockets by chatting with an AI engineer, then launch them and watch what happens.",
};

export const viewport: Viewport = {
  themeColor: "#06070a",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/** Root layout with the app fonts. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable} h-full antialiased`}>
      <body className="grain min-h-full bg-bg text-text">{children}</body>
    </html>
  );
}
