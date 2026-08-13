import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavBar } from "./NavBar";
import "./globals.css";

export const metadata: Metadata = {
  title: "rflx.ai",
  description: "Clinical AI agent guardrail middleware.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-bg text-text-primary antialiased">
        <NavBar />
        {children}
      </body>
    </html>
  );
}
