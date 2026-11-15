/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/market-breadth",
        destination: "/",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
