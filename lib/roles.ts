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
 * True jika user adalah Team IT (jenjang manapun, saat ini hanya ada "Team IT Daerah") --
 * dipakai HANYA untuk satu pengecualian: mengizinkan lihat tab "Kesehatan Sistem" di menu
 * Monitoring & Log (app/(dashboard)/monitoring/page.tsx), yang sebelumnya murni Super Admin.
 * Kesehatan Sistem cuma metrik observability read-only (jumlah pengguna, error rate email,
 * sesi tersimpan) -- BUKAN kontrol berdampak seperti Sesi Aktif (paksa logout) atau Perawatan
 * Sistem (blokir seluruh pengguna), yang tetap SENGAJA dibatasi Super Admin saja sesuai
 * prinsip least privilege. RLS tabel users & email_log sudah lama mengizinkan tingkatan
 * 'daerah' melihat data lintas wilayah (bukan cuma scope sendiri), jadi tidak ada perubahan
 * database yang diperlukan untuk ini -- murni membuka gate UI yang sebelumnya tertutup.
 */
export function isTeamIT(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  return user.role.nama_role.toLowerCase().includes('team it')
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

/**
 * True jika user boleh melihat "Laporan Bulanan" di JENJANGNYA SENDIRI -- perluasan dari
 * canLihatLaporanDaerah supaya Ketua/Wakil Ketua/Sekretaris Desa & Kelompok juga punya laporan
 * bulanan (breakdown per Kelompok utk Desa, per gender utk Kelompok), bukan cuma Ketua Daerah.
 * PPG & Super Admin tetap bisa lihat semua jenjang (dipakai bersamaan dgn getLaporanBulananScope
 * utk tahu RPC/scope mana yg harus dipanggil). HARUS SELALU KONSISTEN dengan pengecekan role di
 * dalam RPC get_laporan_..._desa / get_laporan_..._kelompok (migration
 * add_laporan_bulanan_rpc_scope_desa / add_laporan_bulanan_rpc_scope_kelompok) -- proteksi di
 * database adalah sumber kebenaran sesungguhnya, ini hanya gate UI.
 */
export function canLihatLaporanBulanan(user: Pick<UserProfile, 'role'> | null | undefined): boolean {
  if (!user?.role) return false
  if (user.role.tingkatan === 'super_admin') return true
  if (isPPG(user)) return true
  if (user.role.tingkatan !== 'daerah' && user.role.tingkatan !== 'desa' && user.role.tingkatan !== 'kelompok') return false
  const nama = user.role.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}

/**
 * Menentukan scope Laporan Bulanan yang berlaku utk user ybs -- dipakai UI utk pilih RPC mana
 * yg dipanggil (..._daerah / ..._desa / ..._kelompok) dan parameter scope id apa yg dikirim.
 * PPG & Super Admin default ke scope 'daerah' (rekap se-Daerah, sama seperti sebelumnya) karena
 * mereka tidak terikat desa_id/kelompok_id tertentu.
 */
export function getLaporanBulananScope(
  user: Pick<UserProfile, 'role' | 'desa_id' | 'kelompok_id'> | null | undefined
): { tingkatan: 'daerah' | 'desa' | 'kelompok'; scopeId: string | null } | null {
  if (!canLihatLaporanBulanan(user)) return null
  const t = user?.role?.tingkatan
  if (t === 'desa') return { tingkatan: 'desa', scopeId: user?.desa_id ?? null }
  if (t === 'kelompok') return { tingkatan: 'kelompok', scopeId: user?.kelompok_id ?? null }
  return { tingkatan: 'daerah', scopeId: null }
}

/**
 * Hierarki jenjang, dari yang paling "bawah" ke paling "atas". Dipakai HANYA untuk menentukan
 * siapa boleh membuat/mengubah role user ke tingkatan apa (lihat getAllowedTargetTingkatan di
 * bawah) -- BUKAN untuk kontrol akses fitur lain, yang masing-masing sudah punya gate sendiri
 * di atas (canManageMembers, canManagePresensi, dst).
 */
const TINGKATAN_HIERARKI = ['kelompok', 'desa', 'daerah', 'ppg', 'super_admin'] as const

/**
 * Menentukan daftar tingkatan role yang boleh DIBUAT/DIUBAH oleh user ini saat menambah atau
 * mengedit pengguna lain -- inti dari pembatasan "role di bawah tidak bisa menambahkan role
 * di atasnya". Aturan (dikonfirmasi eksplisit oleh pengguna produk):
 *   - Kelompok  -> hanya boleh membuat Generus (di jenjang kelompok)
 *   - Desa      -> boleh membuat Generus + pengurus Kelompok + pengurus Desa (turun penuh +
 *                  setingkat sendiri)
 *   - Daerah    -> boleh membuat Generus + pengurus Kelompok + pengurus Desa + pengurus Daerah
 *                  (turun penuh + setingkat sendiri), TAPI TIDAK PPG/Super Admin
 *   - PPG       -> tidak relevan, PPG memang sudah dikecualikan dari canManageMembers() di
 *                  atas (PPG murni pengawas read-only, tidak pernah bisa membuat user apapun)
 *   - Super Admin -> boleh membuat semua tingkatan TERMASUK PPG, kecuali sesama Super Admin
 *                  (Super Admin adalah akun tunggal mutlak -- lihat isSuperAdminRole di
 *                  app/api/users/route.ts, aturan itu tetap berlaku terpisah/di atas ini)
 *
 * HARUS SELALU KONSISTEN dengan pengecekan yang sama persis di app/api/users/route.ts
 * (fungsi getAllowedTargetTingkatan versi server) -- di sana adalah enforcement sesungguhnya
 * (service role, bypass RLS), fungsi di sini hanya dipakai UI supaya dropdown role di form
 * Tambah/Edit Pengguna tidak menampilkan pilihan yang toh akan ditolak server.
 */
export function getAllowedTargetTingkatan(user: Pick<UserProfile, 'role'> | null | undefined): string[] {
  if (!user?.role) return []
  const tingkatan = user.role.tingkatan

  if (tingkatan === 'super_admin') {
    // Semua tingkatan kecuali super_admin sendiri (diblokir terpisah, lihat isSuperAdminRole).
    return TINGKATAN_HIERARKI.filter(t => t !== 'super_admin')
  }

  // PPG dicek eksplisit di sini (bukan cuma mengandalkan canManageMembers() di caller) --
  // 'ppg' SENDIRI adalah anggota TINGKATAN_HIERARKI (dipakai sbg batas atas utk role Daerah),
  // jadi kalau tidak di-exclude eksplisit, indexOf('ppg') akan mengembalikan index valid dan
  // fungsi ini keliru mengizinkan PPG "membuat" role sampai ke jenjangnya sendiri. PPG memang
  // tidak pernah boleh membuat/mengubah role siapapun, konsisten dgn PPG dikecualikan dari
  // canManageMembers() di atas.
  if (tingkatan === 'ppg') return []

  const idx = TINGKATAN_HIERARKI.indexOf(tingkatan as typeof TINGKATAN_HIERARKI[number])
  if (idx === -1) return [] // tingkatan tak dikenal -- tidak boleh membuat siapapun

  // Semua tingkatan dari index 0 sampai posisi caller sendiri (turun penuh + setingkat sendiri),
  // tidak termasuk apapun di atasnya.
  return TINGKATAN_HIERARKI.slice(0, idx + 1) as unknown as string[]
}
