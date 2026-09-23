import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PhishHunt | Ethical Phishing Security Testing Platform",
  description: "A dark, modern cybersecurity testing platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.className} bg-background text-foreground antialiased overflow-hidden h-screen flex`}>
        <Sidebar />
        <main className="flex-1 flex flex-col h-screen overflow-y-auto relative">
          {children}
        </main>
      </body>
    </html>
  );
}
