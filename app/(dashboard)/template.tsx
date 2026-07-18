// Template (bukan layout) -- Next.js sengaja me-remount ini di SETIAP navigasi antar
// halaman dashboard (Dashboard -> Kegiatan -> Keuangan dst), beda dari layout.tsx yang
// persist (state sidebar/topbar di app/(dashboard)/layout.tsx TIDAK ikut ter-reset,
// karena template ini ada di LAPISAN DI BAWAH layout, cuma membungkus {children}/konten
// halaman). Efeknya: transisi fade halus tiap pindah halaman, tanpa mengganggu state
// sidebar (collapsed, dark mode, dsb).
export default function DashboardTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-page-in">{children}</div>
}
