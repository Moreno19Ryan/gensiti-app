// Skeleton loader -- pengganti "spinner kecil di kotak putih kosong" yang sebelumnya dipakai
// di ~17 halaman (AUDIT_MENYELURUH_2026-07.md §4c). Skeleton BERBENTUK seperti konten yang
// akan datang (kartu, baris, tabel) sehingga struktur halaman langsung terlihat saat memuat --
// secara persepsi terasa lebih cepat dibanding layar kosong + spinner, walau waktu tunggu
// sebenarnya sama. Animasi `animate-pulse` bawaan Tailwind otomatis dimatikan di bawah
// prefers-reduced-motion lewat aturan global (lihat app/globals.css).
//
// Tiga bentuk generik yang mengcover pola list/tabel yang sudah ada di seluruh app -- dipilih
// dari inventaris nyata (bukan didesain dari nol): kartu (Kegiatan/Pengumuman/Dokumen/pemilih
// kegiatan di Absensi), baris divide-y (detail Absensi/Keuangan), dan tabel (Data Generus/Keuangan).

function Blok({ className = '' }: { className?: string }) {
  return <div className={`bg-slate-200 dark:bg-slate-700 rounded-md animate-pulse ${className}`} />
}

/** Kartu ala Kegiatan/Pengumuman/Dokumen -- judul + baris badge + subjudul singkat. */
export function SkeletonCards({ jumlah = 3 }: { jumlah?: number }) {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {Array.from({ length: jumlah }).map((_, i) => (
        <div key={i} className="bg-white dark:bg-slate-800 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-700">
          <div className="flex items-center gap-2 mb-2.5">
            <Blok className="h-4 w-40" />
            <Blok className="h-4 w-16 rounded-full" />
          </div>
          <Blok className="h-3 w-full max-w-md mb-1.5" />
          <Blok className="h-3 w-24" />
        </div>
      ))}
    </div>
  )
}

/** Baris divide-y ala detail Absensi/Keuangan -- avatar/ikon + 2 baris teks. */
export function SkeletonRows({ jumlah = 5 }: { jumlah?: number }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-700" aria-hidden="true">
      {Array.from({ length: jumlah }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3">
          <Blok className="w-8 h-8 rounded-full shrink-0" />
          <div className="flex-1 min-w-0">
            <Blok className="h-3.5 w-40 mb-1.5" />
            <Blok className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Tabel ala Data Generus/Keuangan -- header asli dipertahankan (tetap terlihat & stabil),
 *  hanya body-nya yang di-skeleton supaya kolom tidak "melompat" begitu data datang. */
export function SkeletonTable({ kolom, baris = 6 }: { kolom: string[]; baris?: number }) {
  return (
    <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden" aria-hidden="true">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
              {kolom.map(k => <th key={k} className="px-4 py-3 font-medium">{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: baris }).map((_, i) => (
              <tr key={i} className="border-b border-slate-50 dark:border-slate-700/60 last:border-0">
                {kolom.map((k, j) => (
                  <td key={k} className="px-4 py-3">
                    {j === 0 ? (
                      <div className="flex items-center gap-3">
                        <Blok className="w-8 h-8 rounded-full shrink-0" />
                        <Blok className="h-3.5 w-28" />
                      </div>
                    ) : (
                      <Blok className="h-3.5 w-16" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
