import { Prisma } from "@prisma/client";

/** Prisma / ドライバが返す「しばらく待てば通る」系の失敗かどうか */
export function isTransientDatabaseError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return (
      e.code === "P1001" ||
      e.code === "P1002" ||
      e.code === "P1008" ||
      e.code === "P1017" ||
      e.code === "P2024"
    );
  }
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }
  if (e instanceof Prisma.PrismaClientRustPanicError) {
    return false;
  }
  const msg = e instanceof Error ? e.message : String(e);
  return /Can't reach database server|Server has closed the connection|Connection terminated unexpectedly|ECONNRESET|ETIMEDOUT|EPIPE|ENOTFOUND|TLS connection|timeout/i.test(
    msg
  );
}
