// Status kegiatan ('upcoming'/'ongoing'/'selesai') dihitung LIVE dari tanggal_mulai/
// tanggal_selesai, BUKAN dibaca dari kolom kegiatan.status tersimpan -- keputusan disengaja
// (diskusi dgn Reno) supaya tidak ada lagi dropdown manual yang harus diingat-ingat Pengurus
// utk dibuka/ditutup. Kolom `status` di database TETAP ada, tapi sekarang murni housekeeping
// utk memicu trigger auto-alpha (lihat migrasi kegiatan_jendela_presensi_otomatis & RPC
// sinkron_status_kegiatan_jika_selesai) -- jangan pernah dipakai lagi utk gating UI.

export type KegiatanStatusComputed = 'upcoming' | 'ongoing' | 'selesai'

export interface KegiatanWaktu {
  tanggal_mulai: string | null
  tanggal_selesai: string | null
  presensi_buka_lebih_awal_menit?: number | null
}

export function computeKegiatanStatus(k: KegiatanWaktu, now: Date = new Date()): KegiatanStatusComputed {
  if (!k.tanggal_mulai) return 'upcoming'
  const t = now.getTime()
  if (t < new Date(k.tanggal_mulai).getTime()) return 'upcoming'
  if (k.tanggal_selesai && t > new Date(k.tanggal_selesai).getTime()) return 'selesai'
  return 'ongoing'
}

// Jendela presensi BEDA dari status tampilan -- bisa terbuka sebelum kegiatan resmi "mulai"
// (opsi buka lebih awal 15/30/60 menit), supaya Generus yang sudah di lokasi bisa langsung
// absen tanpa menunggu jam pastinya. Dipakai PresensiPanel.tsx utk gate UI, dan mencerminkan
// PERSIS pengecekan yang sama di submit_presensi/submit_presensi_rfid (server tetap sumber
// kebenaran, ini cuma supaya UI tidak menampilkan tombol yang pasti akan ditolak server).
export function isPresensiWindowOpen(k: KegiatanWaktu, now: Date = new Date()): boolean {
  if (!k.tanggal_mulai) return false
  const bukaMenit = k.presensi_buka_lebih_awal_menit ?? 0
  const bukaMulai = new Date(k.tanggal_mulai).getTime() - bukaMenit * 60_000
  const t = now.getTime()
  if (t < bukaMulai) return false
  if (k.tanggal_selesai && t > new Date(k.tanggal_selesai).getTime()) return false
  return true
}

// null = tidak bisa dinilai (belum/tidak pernah hadir, atau kegiatan tidak punya tanggal_mulai)
export function isTepatWaktu(waktuAbsen: string | null, tanggalMulai: string | null): boolean | null {
  if (!waktuAbsen || !tanggalMulai) return null
  return new Date(waktuAbsen).getTime() <= new Date(tanggalMulai).getTime()
}
