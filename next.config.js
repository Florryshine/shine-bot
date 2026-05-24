/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  api: {
    responseLimit: '4mb',
  },
};

module.exports = nextConfig;
