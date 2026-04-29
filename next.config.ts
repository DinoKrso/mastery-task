import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', 'tesseract.js'],
  outputFileTracingIncludes: {
    '/api/extract': [
      './eng.traineddata',
      './node_modules/tesseract.js/**',
      './node_modules/pdfjs-dist/legacy/build/**',
      './node_modules/pdfjs-dist/cmaps/**',
      './node_modules/pdfjs-dist/standard_fonts/**',
    ],
  },
};

export default nextConfig;
