import { UserProfile } from './types'

// Nama role yang merepresentasikan Generus biasa (bukan Pengurus Muda-Mudi).
// Generus biasa selalu berada di tingkatan kelompok, karena tempat sambung
// setiap Generus ada di kelompok — role Desa/Daerah selalu dipegang oleh Pengurus.
const GENERUS_BIASA_ROLE_NAMES = ['Generus']

/**
 * True jika user adalah Generus biasa (bukan pengurus, bukan super admin).
 * Generus biasa hanya boleh melihat (Kegiatan, Pengumuman, Dokumen publik) dan
 * mengelola profil sendiri — tidak boleh mengelola data organisasi apapun.
 */
export function isGenerusBiasa(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  return GENERUS_BIASA_ROLE_NAMES.includes(user.role.nama_role)
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
 * atau Super Admin. Kebalikan dari isGenerusBiasa, tapi dieksplisitkan agar niat kode jelas.
 * PPG dikecualikan secara eksplisit -- dia bukan Generus biasa TAPI juga bukan pengurus
 * operasional, jadi tidak boleh otomatis lolos lewat "bukan Generus biasa".
 */
export function isPengurus(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return true
  return !isGenerusBiasa(user)
}

/**
 * Hanya Ketua/Wakil Ketua (di jenjang manapun) dan Super Admin yang boleh
 * mengelola Generus lain (tambah/edit/nonaktifkan/arsip).
 * Role pengurus lain (Sekretaris, Bendahara, Kemandirian, Keputrian, dll),
 * Generus biasa, dan PPG hanya bisa melihat.
 *
 * KHUSUS UNTUK MODUL PENGGUNA/GENERUS -- Super Admin sengaja diberi akses penuh di sini
 * (beda dari konten operasional organisasi lain seperti Kegiatan/Dokumen/Pengumuman,
 * lihat canManageKontenOrganisasi di bawah) karena mengelola akun & data Generus adalah
 * bagian dari perannya sebagai pengelola sistem (reset akses, bantu Ketua yang kesulitan
 * input, dll) -- dikonfirmasi eksplisit lewat audit peran Super Admin.
 */
export function canManageMembers(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return true
  return user.role.nama_role.toLowerCase().includes('ketua')
}

/**
 * Hanya Ketua/Wakil Ketua (di jenjang manapun) yang boleh mengelola KONTEN OPERASIONAL
 * organisasi -- Kegiatan, Dokumen, Pengumuman. Super Admin SENGAJA DIKECUALIKAN di sini,
 * beda dengan canManageMembers() di atas -- perannya murni pengelola sistem/akun, bukan
 * pengurus organisasi, jadi tidak ikut campur urusan operasional harian organisasi
 * (sejalan dengan prinsip yang sama seperti nol akses Keuangan). Super Admin tetap bisa
 * MELIHAT konten ini (RLS SELECT tidak berubah), hanya tidak bisa tambah/edit/hapus.
 */
export function canManageKontenOrganisasi(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return false
  return user.role.nama_role.toLowerCase().includes('ketua')
}

/**
 * Hanya Ketua/Wakil Ketua dan Sekretaris (di jenjang manapun) yang boleh membuka &
 * merotasi kode presensi suatu kegiatan, serta koreksi manual kehadiran. Bendahara dan
 * pengurus lain (Kemandirian, Keputrian, dll) tidak — mereka tetap bisa self check-in
 * seperti Generus biasa. PPG juga tidak -- dia hanya mengawasi lewat dashboard read-only.
 * Super Admin SENGAJA DIKECUALIKAN (sejak audit peran Super Admin) -- mengoperasikan
 * presensi kegiatan adalah urusan operasional organisasi, bukan urusan pengelola sistem;
 * dia tetap bisa melihat rekap presensi tapi tidak bisa memulai sesi atau koreksi kehadiran.
 * RPC generate_kode_presensi di database juga sudah diperbaiki (migration
 * super_admin_readonly_presensi_rpc) agar menolak super_admin secara eksplisit --
 * proteksi ini konsisten di level UI maupun database, bukan cuma UI saja.
 */
export function canManagePresensi(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return false
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}
