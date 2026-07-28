import { describe, it, expect } from 'vitest'
import { computeKegiatanStatus, isPresensiWindowOpen, isTepatWaktu } from './kegiatan-status'

describe('computeKegiatanStatus', () => {
  const now = new Date('2026-07-27T10:00:00Z')

  it('upcoming kalau belum tanggal_mulai', () => {
    expect(computeKegiatanStatus({ tanggal_mulai: '2026-07-27T12:00:00Z', tanggal_selesai: '2026-07-27T14:00:00Z' }, now)).toBe('upcoming')
  })

  it('ongoing kalau antara mulai dan selesai', () => {
    expect(computeKegiatanStatus({ tanggal_mulai: '2026-07-27T09:00:00Z', tanggal_selesai: '2026-07-27T14:00:00Z' }, now)).toBe('ongoing')
  })

  it('selesai kalau sudah lewat tanggal_selesai', () => {
    expect(computeKegiatanStatus({ tanggal_mulai: '2026-07-27T08:00:00Z', tanggal_selesai: '2026-07-27T09:00:00Z' }, now)).toBe('selesai')
  })

  it('upcoming kalau tanggal_mulai null (belum terjadwal)', () => {
    expect(computeKegiatanStatus({ tanggal_mulai: null, tanggal_selesai: null }, now)).toBe('upcoming')
  })

  it('ongoing terus kalau tanggal_selesai null (tidak pernah otomatis selesai)', () => {
    expect(computeKegiatanStatus({ tanggal_mulai: '2026-07-27T08:00:00Z', tanggal_selesai: null }, now)).toBe('ongoing')
  })
})

describe('isPresensiWindowOpen', () => {
  const now = new Date('2026-07-27T10:00:00Z')

  it('tertutup sebelum jendela buka (tanpa buka lebih awal)', () => {
    expect(isPresensiWindowOpen({ tanggal_mulai: '2026-07-27T10:30:00Z', tanggal_selesai: '2026-07-27T12:00:00Z' }, now)).toBe(false)
  })

  it('terbuka begitu masuk tanggal_mulai', () => {
    expect(isPresensiWindowOpen({ tanggal_mulai: '2026-07-27T09:00:00Z', tanggal_selesai: '2026-07-27T12:00:00Z' }, now)).toBe(true)
  })

  it('terbuka lebih awal sesuai presensi_buka_lebih_awal_menit', () => {
    // Kegiatan mulai 10:15, buka 30 menit lebih awal -> terbuka mulai 09:45, now=10:00 harus true
    expect(isPresensiWindowOpen({ tanggal_mulai: '2026-07-27T10:15:00Z', tanggal_selesai: '2026-07-27T12:00:00Z', presensi_buka_lebih_awal_menit: 30 }, now)).toBe(true)
  })

  it('masih tertutup kalau belum masuk jendela buka-lebih-awal', () => {
    // Kegiatan mulai 10:45, buka 15 menit lebih awal -> terbuka mulai 10:30, now=10:00 harus false
    expect(isPresensiWindowOpen({ tanggal_mulai: '2026-07-27T10:45:00Z', tanggal_selesai: '2026-07-27T12:00:00Z', presensi_buka_lebih_awal_menit: 15 }, now)).toBe(false)
  })

  it('tertutup setelah tanggal_selesai', () => {
    expect(isPresensiWindowOpen({ tanggal_mulai: '2026-07-27T08:00:00Z', tanggal_selesai: '2026-07-27T09:00:00Z' }, now)).toBe(false)
  })

  it('tertutup kalau tanggal_mulai null', () => {
    expect(isPresensiWindowOpen({ tanggal_mulai: null, tanggal_selesai: null }, now)).toBe(false)
  })
})

describe('isTepatWaktu', () => {
  it('null kalau belum pernah hadir', () => {
    expect(isTepatWaktu(null, '2026-07-27T10:00:00Z')).toBeNull()
  })

  it('null kalau kegiatan tidak punya tanggal_mulai', () => {
    expect(isTepatWaktu('2026-07-27T10:00:00Z', null)).toBeNull()
  })

  it('true kalau hadir sebelum/tepat tanggal_mulai', () => {
    expect(isTepatWaktu('2026-07-27T09:55:00Z', '2026-07-27T10:00:00Z')).toBe(true)
    expect(isTepatWaktu('2026-07-27T10:00:00Z', '2026-07-27T10:00:00Z')).toBe(true)
  })

  it('false kalau hadir setelah tanggal_mulai', () => {
    expect(isTepatWaktu('2026-07-27T10:05:00Z', '2026-07-27T10:00:00Z')).toBe(false)
  })
})
