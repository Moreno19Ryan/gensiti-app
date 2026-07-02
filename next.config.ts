import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Error TypeScript sebelumnya diabaikan saat build (ignoreBuildErrors: true), yang berisiko
  // meloloskan bug ke production tanpa terdeteksi. Project ini sudah lolos `tsc --noEmit` tanpa
  // error, jadi pengecekan tipe saat build kini diaktifkan kembali (default Next.js).
};

export default nextConfig;
