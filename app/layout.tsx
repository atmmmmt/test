import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "رفقة العمرة | بث الدعاء المباشر",
  description: "تجربة بث صوت مباشر محلي بين الأجهزة بدون بيانات إنترنت عند توافر شبكة Wi-Fi محلية مشتركة.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "رفقة العمرة" },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png"
  }
};
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0c1420" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
