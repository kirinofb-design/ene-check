/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverComponentsExternalPackages: ["puppeteer-extra", "puppeteer-extra-plugin-stealth", "puppeteer"],
  },
};

export default nextConfig;

