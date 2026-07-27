import { describe, it, expect } from 'vitest'
import { computeBadgeGenerus, type AbsensiUntukBadge } from './badges'

function row(tanggal: string, status: AbsensiUntukBadge['status']): AbsensiUntukBadge {
  return { tanggal_kegiatan: tanggal, status }
}

describe('computeBadgeGenerus', () => {
  it('tidak memberi badge apapun kalau riwayat kosong', () => {
    expect(computeBadgeGenerus([])).toEqual([])
  })

  it('tidak memberi streak kalau hadir berturut-turut belum mencapai minimum', () => {
    const riwayat = [
      row('2026-07-01', 'hadir'),
      row('2026-07-08', 'hadir'),
      row('2026-07-15', 'hadir'),
    ]
    expect(computeBadgeGenerus(riwayat).find(b => b.key === 'streak')).toBeUndefined()
  })

  it('memberi badge streak setelah 4 kali hadir berturut-turut', () => {
    const riwayat = [
      row('2026-07-01', 'hadir'),
      row('2026-07-08', 'hadir'),
      row('2026-07-15', 'hadir'),
      row('2026-07-22', 'hadir'),
    ]
    const badge = computeBadgeGenerus(riwayat).find(b => b.key === 'streak')
    expect(badge?.label).toBe('Hadir 4x Berturut-turut')
  })

  it('izin/sakit tidak memutus streak, tapi tidak_hadir (alpha) memutus', () => {
    const riwayatIzin = [
      row('2026-07-01', 'hadir'),
      row('2026-07-08', 'izin'),
      row('2026-07-15', 'hadir'),
      row('2026-07-22', 'hadir'),
      row('2026-07-29', 'hadir'),
    ]
    // 4 'hadir' + 1 izin yang dilewati -> tetap streak 4
    expect(computeBadgeGenerus(riwayatIzin).find(b => b.key === 'streak')?.label).toBe('Hadir 4x Berturut-turut')

    const riwayatAlpha = [
      row('2026-07-01', 'hadir'),
      row('2026-07-08', 'hadir'),
      row('2026-07-15', 'tidak_hadir'),
      row('2026-07-22', 'hadir'),
      row('2026-07-29', 'hadir'),
    ]
    // Alpha di tengah memutus -- cuma 2 hadir terakhir yang terhitung
    expect(computeBadgeGenerus(riwayatAlpha).find(b => b.key === 'streak')).toBeUndefined()
  })

  it('memberi badge rajin bulan ini kalau hadir >=75% dari minimal 3 kegiatan bulan berjalan', () => {
    const riwayat = [
      row('2026-07-01', 'hadir'),
      row('2026-07-08', 'hadir'),
      row('2026-07-15', 'hadir'),
      row('2026-07-22', 'tidak_hadir'),
    ]
    const badge = computeBadgeGenerus(riwayat).find(b => b.key === 'rajin_bulan_ini')
    expect(badge?.deskripsi).toBe('Hadir 3 dari 4 kegiatan bulan ini.')
  })

  it('tidak memberi badge rajin bulan ini kalau kegiatan bulan ini kurang dari 3', () => {
    const riwayat = [row('2026-07-01', 'hadir'), row('2026-07-08', 'hadir')]
    expect(computeBadgeGenerus(riwayat).find(b => b.key === 'rajin_bulan_ini')).toBeUndefined()
  })

  it('memberi badge konsisten kalau 3 bulan kalender berturut-turut masing-masing >=75% hadir', () => {
    const riwayat = [
      row('2026-05-06', 'hadir'), row('2026-05-13', 'hadir'), row('2026-05-20', 'hadir'),
      row('2026-06-03', 'hadir'), row('2026-06-10', 'hadir'), row('2026-06-17', 'hadir'),
      row('2026-07-01', 'hadir'), row('2026-07-08', 'hadir'), row('2026-07-15', 'hadir'),
    ]
    expect(computeBadgeGenerus(riwayat).find(b => b.key === 'konsisten_3_bulan')).toBeDefined()
  })

  it('tidak memberi badge konsisten kalau ada bulan yang bolong (bukan kalender berturut-turut)', () => {
    const riwayat = [
      row('2026-04-01', 'hadir'), row('2026-04-08', 'hadir'), row('2026-04-15', 'hadir'),
      // Mei kosong (bolong)
      row('2026-06-03', 'hadir'), row('2026-06-10', 'hadir'), row('2026-06-17', 'hadir'),
      row('2026-07-01', 'hadir'), row('2026-07-08', 'hadir'), row('2026-07-15', 'hadir'),
    ]
    expect(computeBadgeGenerus(riwayat).find(b => b.key === 'konsisten_3_bulan')).toBeUndefined()
  })

  it('mengabaikan baris tanpa tanggal_kegiatan atau status (data tidak lengkap)', () => {
    const riwayat = [
      row('2026-07-01', 'hadir'),
      { tanggal_kegiatan: null, status: 'hadir' } as AbsensiUntukBadge,
      { tanggal_kegiatan: '2026-07-08', status: null } as AbsensiUntukBadge,
    ]
    expect(computeBadgeGenerus(riwayat)).toEqual([])
  })
})
