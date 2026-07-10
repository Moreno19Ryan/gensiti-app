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
 * Hanya Ketua/Wakil Ketua/Sekretaris (di jenjang manapun) dan Super Admin yang boleh
 * mengelola Generus lain (tambah pengguna baru, edit, nonaktifkan/aktifkan akun, arsip
 * saat status berubah jadi menikah/meninggal dunia/pindah sambung).
 * Role pengurus lain (Bendahara, Kemandirian, Keputrian, dll), Generus biasa, dan PPG
 * hanya bisa melihat. Sekretaris sengaja disertakan (beda dari sebelumnya yang hanya
 * Ketua/Wakil) karena tugas administrasi keanggotaan lazimnya didelegasikan ke Sekretaris.
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
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}

/**
 * Siapa yang boleh MELIHAT menu Data Generus (biodata sensitif: alamat, tanggal lahir,
 * data orang tua/wali, dll). Beda dari canManageMembers() di atas -- ini gate untuk LIHAT,
 * bukan EDIT. Super Admin dan semua Pengurus Muda-Mudi (Ketua/Wakil/Sekretaris/Bendahara/
 * Kemandirian/Keputrian/dll, di jenjang manapun) serta PPG boleh melihat, tapi hanya yang
 * lolos canManageMembers() yang boleh mengedit -- lihat pola disabled fieldset di
 * data-generus/page.tsx. Generus biasa TIDAK boleh melihat sama sekali -- data pribadinya
 * sendiri tetap bisa dilihat lewat halaman Profil (yang mengambil data lewat /api/users,
 * bukan query langsung ke tabel generus, jadi tidak terpengaruh RLS ini).
 * RLS tabel generus (migration add_get_user_nama_role_and_restrict_generus_biasa_rls) sudah
 * diperketat sejalan dengan ini di level database -- proteksi bukan cuma UI.
 */
export function canViewGenerusData(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isGenerusBiasa(user)) return false
  return true
}

/**
 * Ketua/Wakil Ketua/Sekretaris (di jenjang manapun) yang boleh mengelola KONTEN OPERASIONAL
 * organisasi -- Kegiatan, Dokumen, Pengumuman. Sekretaris disertakan (diputuskan eksplisit)
 * karena lazimnya urusan administrasi & surat-menyurat organisasi didelegasikan ke Sekretaris,
 * konsisten dengan pola yang sama di canManageMembers() dan canManagePresensi() di atas.
 * Super Admin SENGAJA DIKECUALIKAN di sini, beda dengan canManageMembers() di atas --
 * perannya murni pengelola sistem/akun, bukan pengurus organisasi, jadi tidak ikut campur
 * urusan operasional harian organisasi (sejalan dengan prinsip yang sama seperti nol akses
 * Keuangan). Super Admin tetap bisa MELIHAT konten ini (RLS SELECT tidak berubah), hanya
 * tidak bisa tambah/edit/hapus.
 * RLS kegiatan_all_(daerah/desa/kelompok), dokumen_all_(dst), pengumuman_all_(dst)
 * (fungsi is_pengurus_konten()) agar konsisten -- sebelumnya RLS desa/kelompok memakai
 * is_pengurus() generik yang keliru meloloskan SEMUA role pengurus (Bendahara, Kemandirian,
 * dll), dan RLS daerah tidak mengecek jabatan sama sekali.
 */
export function canManageKontenOrganisasi(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return false
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
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

/**
 * True jika user adalah Bendahara di jenjang manapun (Kelompok/Desa/Daerah). Sejak audit
 * relasi hak akses lintas wilayah, HANYA Bendahara yang boleh mencatat transaksi Keuangan
 * langsung (tambah/edit/hapus) -- sebelumnya isPengurus() dipakai di sini yang keliru
 * meloloskan SEMUA role pengurus (Kemandirian, Keputrian, dll), padahal RLS database
 * hanya pernah mengizinkan Ketua/Wakil Ketua. Sekarang diperbaiki agar konsisten dgn
 * jobdesk organisasi: Bendahara kelola langsung, pengurus lain WAJIB lewat alur pengajuan
 * reimbursement (lihat canAjukanReimbursement) yang perlu di-ACC Bendahara.
 * Super Admin & PPG SENGAJA TIDAK termasuk -- konsisten dgn prinsip yang sama seperti
 * modul operasional lain (Kegiatan/Dokumen/Pengumuman/Presensi).
 */
export function isBendahara(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  return user.role.nama_role.toLowerCase().includes('bendahara')
}

/**
 * True jika user boleh MENGAJUKAN reimbursement (minta approval Bendahara) -- semua
 * pengurus operasional selain Bendahara sendiri (Ketua, Wakil Ketua, Sekretaris,
 * Kemandirian, Keputrian, dll) di jenjang Kelompok/Desa/Daerah. Bendahara tidak perlu
 * mengajukan (dia input langsung ke Keuangan), Generus biasa & PPG bukan pengurus
 * operasional sehingga tidak berwenang mengajukan transaksi apapun.
 */
export function canAjukanReimbursement(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (isPPG(user)) return false
  if (user.role.tingkatan === 'super_admin') return false
  if (isGenerusBiasa(user)) return false
  if (isBendahara(user)) return false
  return true
}

/**
 * True jika user boleh melihat "Laporan Bulanan" tingkat Daerah (rekap kehadiran se-Bekasi
 * Timur per Desa/gender/kelas ngaji, tren 12 bulan, pertumbuhan Generus) -- adaptasi dari
 * laporan rekap Excel bulanan yang sebelumnya dikerjakan manual oleh PPG. HANYA PPG, Ketua/
 * Wakil Ketua/Sekretaris Daerah, dan Super Admin -- Desa/Kelompok tidak relevan krn laporan
 * ini murni scope se-Daerah, mereka tetap punya rekap kehadiran sendiri lewat menu Absensi
 * biasa (per kegiatan, per scope mereka). HARUS SELALU KONSISTEN dengan pengecekan role di
 * dalam RPC get_laporan_kehadiran_bulanan_daerah / get_laporan_kelas_ngaji_daerah /
 * get_tren_kehadiran_tahunan_daerah (migration create_laporan_bulanan_daerah_rpc) -- proteksi
 * di database adalah sumber kebenaran sesungguhnya, ini hanya gate UI supaya tombolnya tidak
 * ditampilkan ke role yang toh akan ditolak RPC-nya.
 */
export function canLihatLaporanDaerah(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (user.role.tingkatan === 'super_admin') return true
  if (isPPG(user)) return true
  if (user.role.tingkatan !== 'daerah') return false
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}
