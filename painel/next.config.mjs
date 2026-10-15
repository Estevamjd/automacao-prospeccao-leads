/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // O painel lida com dados de prospecção: nada aqui deve ser indexado
  // nem embutido em outro site.
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
};
export default nextConfig;
