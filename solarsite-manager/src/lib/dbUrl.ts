/**
 * Prisma が参照する PostgreSQL URL に、Neon 等で切れやすい接続の緩和パラメータを付与する。
 * 既に同名パラメータがある場合は上書きしない。
 */
export function augmentPostgresDatabaseUrl(raw: string | undefined): string {
  if (!raw) return "";
  if (!/^postgres(ql)?:\/\//i.test(raw)) return raw;
  try {
    const u = new URL(raw);
    if (!u.searchParams.has("connect_timeout")) {
      u.searchParams.set("connect_timeout", "30");
    }
    if (!u.searchParams.has("sslmode") && /\.neon\.tech$/i.test(u.hostname)) {
      u.searchParams.set("sslmode", "require");
    }
    return u.toString();
  } catch {
    return raw;
  }
}
