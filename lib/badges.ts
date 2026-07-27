// B1 -- Gamifikasi ringan untuk Generus (badge personal, BUKAN leaderboard/ranking publik --
// keputusan disengaja pasca-diskusi WISHLIST_ASSESSMENT.md §B1: leaderboard antar-orang/
// kelompok berisiko memicu kompetisi tidak sehat di organisasi keagamaan/sosial begini).
// Semua badge dihitung on-the-fly dari data absensi yang sudah ada -- TIDAK ADA tabel/RPC
// baru, murni derived data, supaya kriterianya gampang disesuaikan nanti tanpa migrasi.

export type BadgeKey = 'streak' | 'rajin_bulan_ini' | 'konsisten_3_bulan'

export interface Badge {
  key: BadgeKey
  emoji: string
  label: string
  deskripsi: string
}

export interface AbsensiUntukBadge {
  status: 'hadir' | 'tidak_hadir' | 'izin' | 'sakit' | null
  // Sengaja pakai kegiatan.tanggal_mulai (jadwal), BUKAN absensi.waktu_absen (jam check-in) --
  // supaya pengelompokan bulan & urutan kronologis mengikuti kalender kegiatan sesungguhnya,
  // bukan kapan generus kebetulan menekan tombol presensi.
  tanggal_kegiatan: string | null
}

// Threshold awal berdasar asumsi kegiatan MINGGUAN -- masih tebakan awal krn organisasi baru
// mulai pakai presensi digital (belum ada data multi-bulan asli saat badge ini ditulis).
// Wajar disesuaikan lagi setelah beberapa bulan berjalan kalau ternyata terlalu gampang/susah.
const STREAK_MIN = 4
const RAJIN_MIN_KEGIATAN = 3
const RAJIN_RATIO_MIN = 0.75
const KONSISTEN_BULAN_MIN = 3

function monthKey(tanggal: string): string {
  return tanggal.slice(0, 7) // 'YYYY-MM'
}

function monthIndex(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return y * 12 + (m - 1)
}

function tingkatKehadiran(rows: AbsensiUntukBadge[]): number {
  return rows.filter(r => r.status === 'hadir').length / rows.length
}

export function computeBadgeGenerus(riwayat: AbsensiUntukBadge[]): Badge[] {
  const valid = riwayat.filter(
    (r): r is AbsensiUntukBadge & { tanggal_kegiatan: string } => !!r.tanggal_kegiatan && !!r.status
  )
  const sorted = [...valid].sort((a, b) => a.tanggal_kegiatan.localeCompare(b.tanggal_kegiatan))
  const badges: Badge[] = []

  // 1. Streak hadir berturut-turut, dihitung mundur dari kegiatan terbaru. Izin/sakit
  // (ketidakhadiran yang dimaklumi) DILEWATI -- tidak memutus streak, tapi juga tidak
  // menambah -- supaya generus yang izin/sakit sah tidak dirugikan dibanding yang alpha.
  // Hanya 'tidak_hadir' (alpha) yang memutus streak.
  let streak = 0
  for (let i = sorted.length - 1; i >= 0; i--) {
    const status = sorted[i].status
    if (status === 'hadir') streak++
    else if (status === 'tidak_hadir') break
  }
  if (streak >= STREAK_MIN) {
    badges.push({
      key: 'streak',
      emoji: '🔥',
      label: `Hadir ${streak}x Berturut-turut`,
      deskripsi: `Konsisten hadir ${streak} kegiatan tanpa alpha.`,
    })
  }

  const byMonth = new Map<string, AbsensiUntukBadge[]>()
  for (const r of sorted) {
    const key = monthKey(r.tanggal_kegiatan)
    if (!byMonth.has(key)) byMonth.set(key, [])
    byMonth.get(key)!.push(r)
  }
  const monthKeys = [...byMonth.keys()].sort()

  // 2. Rajin bulan ini -- hadir >=75% dari kegiatan bulan berjalan, minimal 3 kegiatan
  // (supaya bulan yang baru mulai/kegiatan masih sedikit tidak langsung "lolos" secara semu).
  const currentMonthKey = monthKeys[monthKeys.length - 1]
  const currentMonthRows = currentMonthKey ? byMonth.get(currentMonthKey)! : []
  if (currentMonthRows.length >= RAJIN_MIN_KEGIATAN && tingkatKehadiran(currentMonthRows) >= RAJIN_RATIO_MIN) {
    const hadirCount = currentMonthRows.filter(r => r.status === 'hadir').length
    badges.push({
      key: 'rajin_bulan_ini',
      emoji: '📅',
      label: 'Rajin Bulan Ini',
      deskripsi: `Hadir ${hadirCount} dari ${currentMonthRows.length} kegiatan bulan ini.`,
    })
  }

  // 3. Kontribusi konsisten -- 3 bulan KALENDER BERTURUT-TURUT (bukan cuma 3 bulan terakhir
  // yang kebetulan ada datanya) masing-masing hadir >=75%.
  if (monthKeys.length >= KONSISTEN_BULAN_MIN) {
    const last3 = monthKeys.slice(-KONSISTEN_BULAN_MIN)
    const berurutan = last3.every((k, i) => i === 0 || monthIndex(k) === monthIndex(last3[i - 1]) + 1)
    const semuaLolos = berurutan && last3.every(k => tingkatKehadiran(byMonth.get(k)!) >= RAJIN_RATIO_MIN)
    if (semuaLolos) {
      badges.push({
        key: 'konsisten_3_bulan',
        emoji: '🌱',
        label: 'Kontribusi Konsisten',
        deskripsi: 'Rajin hadir 3 bulan berturut-turut.',
      })
    }
  }

  return badges
}
