import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DataCollectSection from "@/components/reports/DataCollectSection";
import ExcelExportSection from "@/components/reports/ExcelExportSection";

export default async function ReportsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const pageTitleStyle = {
    margin: 0,
    fontSize: "30px",
    lineHeight: 1.2,
    fontWeight: 800,
    color: "#0f172a",
    letterSpacing: "-0.02em",
  };

  return (
    <div className="w-full" style={{ maxWidth: "1120px", display: "flex", flexDirection: "column", gap: "6px", paddingTop: "10px" }}>
      <h1 style={pageTitleStyle}>レポート</h1>

      <div className="reports-two-col">
        <DataCollectSection />
        <ExcelExportSection />
      </div>
    </div>
  );
}

