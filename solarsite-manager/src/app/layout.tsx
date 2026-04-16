import type { Metadata } from "next";
import "./globals.css";
import { SessionProvider } from "@/components/providers/SessionProvider";

export const metadata: Metadata = {
  title: "SolarSite Manager",
  description: "太陽光発電所統合管理システム (MVP)",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="bg-slate-950 text-slate-50">
        <SessionProvider>
        <div className="min-h-screen flex flex-col">
          <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur">
            <div className="w-full flex items-center" style={{ maxWidth: "420px", padding: "12px 0", margin: "0" }}>
              <span className="text-sm font-semibold tracking-wide text-sky-400">
                SolarSite Manager
              </span>
            </div>
          </header>
          <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-slate-800 bg-slate-900/60">
            <div className="w-full text-xs text-slate-500 flex justify-start" style={{ maxWidth: "420px", padding: "12px 0", margin: "0" }}>
              <span>© {new Date().getFullYear()} SolarSite Manager</span>
            </div>
          </footer>
        </div>
        </SessionProvider>
      </body>
    </html>
  );
}

