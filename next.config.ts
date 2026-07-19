import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Error TypeScript sebelumnya diabaikan saat build (ignoreBuildErrors: true), yang berisiko
  // meloloskan bug ke production tanpa terdeteksi. Project ini sudah lolos `tsc --noEmit` tanpa
  // error, jadi pengecekan tipe saat build kini diaktifkan kembali (default Next.js).
};

export default withSentryConfig(nextConfig, {
  // Slug organisasi & proyek Sentry, diambil dari environment variable
  // (SENTRY_ORG / SENTRY_PROJECT) saat build di CI/Vercel. Tidak wajib untuk
  // development lokal -- hanya dipakai saat upload source maps.
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Hanya upload source maps kalau auth token tersedia (mis. di CI/Vercel).
  // Tanpa token, build tetap sukses tapi source maps tidak di-upload.
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,

  widenClientFileUpload: true,
});
