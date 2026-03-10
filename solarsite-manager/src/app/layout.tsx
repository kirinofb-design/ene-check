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
            <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
              <span className="text-sm font-semibold tracking-wide text-sky-400">
                SolarSite Manager
              </span>
              <span className="text-xs text-slate-400">
                Spec.md を唯一の正解として実装中
              </span>
            </div>
          </header>
          <main className="flex-1 mx-auto max-w-6xl w-full px-4 py-8">
            {children}
          </main>
          <footer className="border-t border-slate-800 bg-slate-900/60">
            <div className="mx-auto max-w-6xl px-4 py-3 text-xs text-slate-500 flex justify-between">
              <span>© {new Date().getFullYear()} SolarSite Manager</span>
              <span>Phase 1 MVP</span>
            </div>
          </footer>
        </div>
        </SessionProvider>
      </body>
    </html>
  );
}

