import { auth } from "@/auth";
import { redirect } from "next/navigation";
import DataCollectSection from "@/components/reports/DataCollectSection";
import ExcelExportSection from "@/components/reports/ExcelExportSection";

export default async function ReportsPage() {
  const session = await auth();
  if (!session) redirect("/login");
  const pageWrapStyle = {
    width: "100%",
    maxWidth: "1120px",
    minWidth: 0,
    margin: "0",
    paddingTop: "10px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
  };
  const pageTitleStyle = {
    margin: 0,
    marginBottom: "8px",
    fontSize: "30px",
    lineHeight: 1.2,
    fontWeight: 800,
    letterSpacing: "-0.02em",
  };

  return (
    <div style={pageWrapStyle}>
      <h1 style={pageTitleStyle}>レポート</h1>

      <div className="reports-two-col">
        <DataCollectSection />
        <ExcelExportSection />
      </div>
    </div>
  );
}

