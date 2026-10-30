import type { Metadata, Viewport } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "رفقة العمرة | التسجيل وتوزيع المجموعات",
  description: "تطبيق رفقة العمرة: كل شخص يسجل اسمه من رابط واحد، ومسؤول الرحلة يوزع المشاركين على المجموعات ويحفظ توزيعهم قبل السفر.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {capable:true,statusBarStyle:"black-translucent",title:"رفقة العمرة"},
  icons:{icon:"/icons/icon-192.png",apple:"/icons/icon-192.png"}
};
export const viewport: Viewport = {width:"device-width",initialScale:1,themeColor:"#102b29"};
export default function RootLayout({children}:{children:React.ReactNode}){
  return <html lang="ar" dir="rtl"><body>{children}</body></html>;
}
