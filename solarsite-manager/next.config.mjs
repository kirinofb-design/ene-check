/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: [
      "puppeteer-extra",
      "puppeteer-extra-plugin-stealth",
      "puppeteer-extra-plugin-user-preferences",
      "puppeteer-extra-plugin-user-data-dir",
      "puppeteer",
      // バンドルに入れると @sparticuz/chromium の bin パスが壊れるため外部モジュールとして解決させる
      "playwright-core",
      "@sparticuz/chromium",
    ],
    // 外部化しても念のためトレースに含める（Vercel のサーバーレス同梱用）
    outputFileTracingIncludes: {
      "/api/auto-login": ["./node_modules/@sparticuz/chromium/**"],
      // puppeteer-extra-plugin-stealth は内部で evasions を動的 require するため、
      // Next のファイルトレースだけだと本番バンドルに evasions が欠けて落ちることがある。
      "/api/collect/prewarm": [
        "./node_modules/@sparticuz/chromium/**",
        "./node_modules/playwright-core/**",
      ],
      "/api/collect/all": [
        "./node_modules/@sparticuz/chromium/**",
        "./node_modules/puppeteer-extra/**",
        "./node_modules/puppeteer-extra-plugin-stealth/**",
        "./node_modules/puppeteer-extra-plugin-user-preferences/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/node_modules/**",
        "./node_modules/puppeteer/**",
        "./node_modules/fs-extra/**",
        "./node_modules/universalify/**",
        "./node_modules/jsonfile/**",
        "./node_modules/graceful-fs/**",
        "./node_modules/rimraf/**",
      ],
      "/api/collect/sma": [
        "./node_modules/@sparticuz/chromium/**",
        "./node_modules/puppeteer-extra/**",
        "./node_modules/puppeteer-extra-plugin-stealth/**",
        "./node_modules/puppeteer-extra-plugin-user-preferences/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/node_modules/**",
        "./node_modules/puppeteer/**",
        "./node_modules/fs-extra/**",
        "./node_modules/universalify/**",
        "./node_modules/jsonfile/**",
        "./node_modules/graceful-fs/**",
        "./node_modules/rimraf/**",
      ],
      "/api/cron/collect/[system]": [
        "./node_modules/@sparticuz/chromium/**",
        "./node_modules/puppeteer-extra/**",
        "./node_modules/puppeteer-extra-plugin-stealth/**",
        "./node_modules/puppeteer-extra-plugin-user-preferences/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/**",
        "./node_modules/puppeteer-extra-plugin-user-data-dir/node_modules/**",
        "./node_modules/puppeteer/**",
        "./node_modules/fs-extra/**",
        "./node_modules/universalify/**",
        "./node_modules/jsonfile/**",
        "./node_modules/graceful-fs/**",
        "./node_modules/rimraf/**",
      ],
    },
  },
  // middleware より先に適用される。NextAuth の /api/auth/error が 500 でもここで /login へ逃がす。
  async redirects() {
    return [
      {
        source: "/api/auth/error",
        destination: "/login",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;

