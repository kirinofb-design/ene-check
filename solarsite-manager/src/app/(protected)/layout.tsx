import { auth, signOut } from "@/auth";
import { ProtectedNavButtons } from "@/components/ProtectedNavButtons";

async function logout() {
  "use server";
  await signOut({ redirectTo: "/" });
}

export default async function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const navWrapStyle = {
    width: "fit-content",
    margin: "0",
    padding: "0",
  } as const;
  const logoutBtnStyle = {
    display: "inline-flex",
    alignItems: "center",
    borderRadius: "12px",
    border: "1px solid #fb7185",
    backgroundColor: "#f43f5e",
    padding: "5px 10px",
    fontSize: "11px",
    fontWeight: 700,
    color: "#ffffff",
    boxShadow: "0 1px 2px rgba(0,0,0,0.12)",
    cursor: "pointer",
  } as const;

  return (
    <div className="space-y-8">
      <div style={{ width: "100%", maxWidth: "1120px", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <nav style={navWrapStyle}>
          <div className="flex items-center justify-between gap-3">
            <ProtectedNavButtons />
          </div>
        </nav>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" }}>
          <form action={logout}>
            <button
              type="submit"
              className="inline-flex items-center rounded-xl border border-rose-300 bg-rose-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:-translate-y-0.5 hover:bg-rose-600 hover:shadow active:translate-y-0"
              style={logoutBtnStyle}
            >
              ログアウト
            </button>
          </form>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a", textAlign: "right" }}>
            ログインID：{session?.user?.email ?? "-"}
          </span>
        </div>
      </div>
      {children}
    </div>
  );
}
