import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    data: {
      status: "ok",
      message: "SolarSite Manager API is up",
    },
  });
}

