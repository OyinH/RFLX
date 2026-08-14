import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Space_Grotesk } from "next/font/google";
import { NavBar } from "./NavBar";
import "./globals.css";

// Wordmark-only font, deliberately not the app's body font (docs/design.md's
// "Inter... no custom font loading required" was the right call for UI text,
// but a logotype set in the same font as surrounding body copy just reads as
// text next to an icon, not a designed brand mark. Scoped to the "rflx.ai"
// wordmark only (app/NavBar.tsx) via the --font-logo CSS variable — never
// applied to body/UI text.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["700"],
  variable: "--font-logo",
});

export const metadata: Metadata = {
  title: "rflx.ai",
  description: "Clinical AI agent guardrail middleware.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body className="bg-bg text-text-primary antialiased">
        <a href="#main-content" className="skip-link">
          Skip to content
        </a>
        <NavBar />
        {children}
      </body>
    </html>
  );
}
