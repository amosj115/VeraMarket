import type { Metadata } from "next";
import { appUrl } from "@/lib/app-url";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthSessionProvider } from "@/components/providers/session-provider";
import { SiteHeader } from "@/components/nav/site-header";
import { MobileNav } from "@/components/nav/mobile-nav";
import { VerificationBanner } from "@/components/profile/verification-banner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL(appUrl()),
  title: {
    default: "Vera Market — Buy Real. Sell Safe.",
    template: "%s | Vera Market",
  },
  description:
    "Vera Market is a trusted marketplace to buy and sell products, discover shops and services, and find real estate. Buy Real. Sell Safe.",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background">
        <AuthSessionProvider>
          <SiteHeader />
          <VerificationBanner />
          <main className="flex-1 pb-16 md:pb-0">{children}</main>
          <MobileNav />
        </AuthSessionProvider>
      </body>
    </html>
  );
}
