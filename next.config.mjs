import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
  outputFileTracingIncludes: {
    '/api/extension/download': ['./extension/memoar-extension.zip'],
  },
};

export default nextConfig;
