import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QA Intelligence Agent",
  description: "Personal QA copilot for requirement analysis, test design, and benchmark generation.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
