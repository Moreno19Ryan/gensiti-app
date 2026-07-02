import { UserProfile } from './types'

// Nama role yang merepresentasikan ru'yah biasa (bukan Pengurus Muda-Mudi).
// Ru'yah biasa selalu berada di tingkatan kelompok, karena tempat sambung
// setiap ru'yah ada di kelompok — role Desa/Daerah selalu dipegang oleh Pengurus.
const RUYAH_BIASA_ROLE_NAMES = ['Anggota']

/**
 * True jika user adalah ru'yah biasa (bukan pengurus, bukan super admin).
 * Ru'yah biasa hanya boleh melihat (Kegiatan, Pengumuman, Dokumen publik) dan
 * mengelola profil sendiri — tidak boleh mengelola data organisasi apapun.
 */
export function isRuyahBiasa(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  return RUYAH_BIASA_ROLE_NAMES.includes(user.role.nama_role)
}

/**
 * True jika user adalah PPG (Penggerak Pembina Generus) -- pengawas/pembina KMM
 * se-Daerah Bekasi Timur, berada di atas jenjang Daerah. PPG BUKAN pengurus operasional:
 * tidak mengelola anggota/kegiatan/keuangan/dokumen/pengumuman secara langsung, hanya
 * read-only lintas Desa/Kelompok, plus approval kegiatan/pengumuman tingkat Daerah dan
 * catatan pembinaan.
 */
export function isPPG(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  return user.role.tingkatan === 'ppg'
}

/**
 * True jika user adalah Pengurus Muda-Mudi di jenjang manapun (Kelompok/Desa/Daerah)
 * atau Super Admin. Kebalikan dari isRuyahBiasa, tapi dieksplisitkan agar niat kode jelas.
 * PPG dikecualikan secara eksplisit -- dia bukan ru'yah biasa TAPI juga bukan pengurus
 * operasional, jadi tidak boleh otomatis lolos lewat "bukan ru'yah biasa".
 */
export function isPengurus(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return true
  return !isRuyahBiasa(user)
}

/**
 * Hanya Ketua/Wakil Ketua (di jenjang manapun) dan Super Admin yang boleh
 * mengelola anggota lain (tambah/edit/nonaktifkan/arsip).
 * Role pengurus lain (Sekretaris, Bendahara, Kemandirian, Keputrian, dll),
 * ru'yah biasa, dan PPG hanya bisa melihat.
 */
export function canManageMembers(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return true
  return user.role.nama_role.toLowerCase().includes('ketua')
}

/**
 * Hanya Ketua/Wakil Ketua, Sekretaris (di jenjang manapun), dan Super Admin yang boleh
 * membuka & merotasi kode presensi suatu kegiatan. Bendahara dan pengurus lain (Kemandirian,
 * Keputrian, dll) tidak — mereka tetap bisa self check-in seperti ru'yah biasa. PPG juga
 * tidak -- dia hanya mengawasi lewat dashboard read-only, bukan mengoperasikan presensi.
 * Catatan: RPC generate_kode_presensi di database memakai is_pengurus() yang lebih longgar
 * (semua pengurus), jadi pembatasan tambahan ini murni di level UI sesuai kesepakatan.
 */
export function canManagePresensi(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return true
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}
