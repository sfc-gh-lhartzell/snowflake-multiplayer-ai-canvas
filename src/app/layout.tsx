import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { THEME_PREHYDRATE_SCRIPT } from "@/lib/theme";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Agent Canvas Plus",
  description: "Docs, slides, and artifacts your team builds together with an agent, inside Snowflake.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        {/* Set data-theme on <html> before React hydrates so there's no
            flash of light theme on a dark system. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_PREHYDRATE_SCRIPT }} />
      </head>
      <body style={{ fontFamily: "var(--font-inter), var(--font-sans)" }}>
        {children}
      </body>
    </html>
  );
}
