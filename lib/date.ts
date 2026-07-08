// Helper perhitungan tanggal yang dipakai lintas halaman (form Tambah Pengguna, Data
// Generus, modal Detail Pengguna, dst). Usia SENGAJA TIDAK disimpan sebagai kolom di
// database -- selalu dihitung ulang dari tanggal_lahir setiap kali ditampilkan, supaya
// otomatis akurat & bertambah sendiri tiap tahun tanpa perlu proses terjadwal (cron)
// yang bisa gagal/telat dan bikin angkanya basi.

/**
 * Hitung usia (tahun penuh) dari tanggal lahir, dibandingkan ke tanggal hari ini.
 * Memperhitungkan bulan & tanggal secara akurat (bukan cuma selisih tahun), sehingga
 * usia baru bertambah tepat di hari ulang tahun, bukan di awal tahun kalender.
 *
 * @param tanggalLahir string tanggal (format apapun yang bisa diparse `new Date()`,
 *   mis. "1998-08-17" dari kolom date Postgres) atau null/undefined.
 * @returns usia dalam tahun (bilangan bulat >= 0), atau null kalau tanggal_lahir kosong
 *   atau tidak valid (mis. baru diisi sebagian di form, atau data lama yang belum lengkap).
 */
export function calculateAge(tanggalLahir: string | null | undefined): number | null {
  if (!tanggalLahir) return null
  const lahir = new Date(tanggalLahir)
  if (isNaN(lahir.getTime())) return null

  const sekarang = new Date()
  let usia = sekarang.getFullYear() - lahir.getFullYear()

  const belumUlangTahunTahunIni =
    sekarang.getMonth() < lahir.getMonth() ||
    (sekarang.getMonth() === lahir.getMonth() && sekarang.getDate() < lahir.getDate())
  if (belumUlangTahunTahunIni) usia--

  // Pengaman: tanggal lahir di masa depan (input keliru) -- jangan tampilkan usia negatif.
  return usia < 0 ? null : usia
}

/** Format usia untuk ditampilkan di UI, mis. "27 tahun". Mengembalikan '-' kalau tidak diketahui. */
export function formatAge(tanggalLahir: string | null | undefined): string {
  const usia = calculateAge(tanggalLahir)
  return usia === null ? '-' : `${usia} tahun`
}
