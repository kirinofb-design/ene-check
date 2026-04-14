/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["puppeteer-extra", "puppeteer-extra-plugin-stealth", "puppeteer"],
    // Next 14.2.x: ここに置かないと Vercel の関数バンドルに chromium の brotli/bin が入らない
    outputFileTracingIncludes: {
      "/api/auto-login": [
        "./node_modules/@sparticuz/chromium/**",
        "./node_modules/@sparticuz/chromium/bin/**",
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

