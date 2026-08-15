import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";
import { HealthBadge } from "@/components/health-badge";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Outreach Console",
  description: "Personalized job-outreach email campaigns",
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/templates", label: "Templates" },
  { href: "/contacts", label: "Contacts" },
];

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-20">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-semibold tracking-tight text-neutral-50">
                Outreach Console
              </Link>
              <nav className="flex items-center gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-1.5 text-sm text-neutral-300 hover:text-neutral-50 hover:bg-neutral-800 transition-colors"
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
            <HealthBadge />
          </div>
        </header>
        <main className="flex-1 mx-auto w-full max-w-6xl px-4 sm:px-6 py-6">
          {children}
        </main>
      </body>
    </html>
  );
}
