import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "رفقة العمرة | تنظيم البث المباشر بدون إنترنت",
  description: "دليل تنظيم 100 معتمر في 7 مجموعات للصوت المباشر عبر تطبيق Murmur بلوتوث Mesh دون إنترنت أو نقطة اتصال؛ يتطلب تحميل التطبيق واختباره مسبقاً.",
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
