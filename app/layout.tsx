import "./globals.css";
import { Plus_Jakarta_Sans } from "next/font/google";
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });
export const metadata = { title: "PartnerScope – Franchise Partner Engine", description: "Screen franchise applicants, fill territories pin by pin, and onboard partners in their own language." };
export const viewport = { themeColor: "#000042" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en" className={jakarta.variable}><body>{children}</body></html>);
}
