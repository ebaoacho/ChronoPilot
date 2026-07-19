import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PwaClient } from "@/components/pwa-client";

export const metadata: Metadata = {
  title: { default: "ChronoPilot", template: "%s · ChronoPilot" },
  description: "人生をデバッグするAI Life OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ChronoPilot" },
  icons: { apple: "/icons/apple-touch-icon.svg", icon: "/icons/icon-192.svg" }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: [{ media:"(prefers-color-scheme: light)", color:"#f5f6f8" },{ media:"(prefers-color-scheme: dark)", color:"#0d0f12" }] };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}<PwaClient /></body></html>;
}
