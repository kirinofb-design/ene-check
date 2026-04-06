import { MonitoringCredentialsForm } from "@/components/settings/MonitoringCredentialsForm";
import { SmaCookieForm } from "@/components/settings/SmaCookieForm";

export default async function SettingsPage() {
  const pageWrapStyle = {
    width: "100%",
    maxWidth: "1120px",
    minWidth: 0,
    margin: "0",
    paddingTop: "10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "6px",
  };
  const sectionStyle = {
    width: "100%",
    maxWidth: "none",
    minWidth: 0,
    overflowX: "hidden" as const,
    border: "1px solid #cbd5e1",
    borderRadius: "14px",
    background: "#ffffff",
    boxShadow: "0 4px 14px rgba(15, 23, 42, 0.06)",
    padding: "18px",
    display: "flex",
    flexDirection: "column" as const,
    gap: "10px",
  };
  const sectionTitleStyle = {
    margin: 0,
    fontSize: "15px",
    fontWeight: 700,
    color: "#0f172a",
  };
  const sectionMainTitleStyle = {
    margin: 0,
    fontSize: "18px",
    fontWeight: 700,
    color: "#1e293b",
  };
  const pageTitleStyle = {
    margin: 0,
    fontSize: "30px",
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  };

  return (
    <div className="space-y-6" style={pageWrapStyle}>
      <h1 style={pageTitleStyle}>設定</h1>

      <section className="space-y-3" style={sectionStyle}>
        <h2 style={sectionMainTitleStyle}>
          監視サイトログイン情報（自動収集 Step 1）
        </h2>
        <MonitoringCredentialsForm />
      </section>

      <section className="space-y-3" style={sectionStyle}>
        <h2 style={sectionMainTitleStyle}>SMA Cookie 登録（自動収集 Step 2）</h2>
        <SmaCookieForm />
      </section>

    </div>
  );
}
