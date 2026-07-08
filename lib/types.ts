export type Tingkatan = 'super_admin' | 'daerah' | 'desa' | 'kelompok' | 'ppg'

export type StatusApproval = 'menunggu_ppg' | 'disetujui' | 'ditolak'

export interface UserProfile {
  id: string
  email: string
  // Nama pengguna untuk login (uppercase, unik) -- dipakai halaman /login lewat
  // /api/resolve-login untuk diterjemahkan jadi email asli. Bisa null untuk akun lama
  // yang belum di-backfill. Email di atas TETAP jadi identitas Supabase Auth &
  // tujuan notifikasi, tidak berubah oleh fitur ini.
  login_username: string | null
  // Token sesi aktif saat ini (dibuat ulang setiap kali form login berhasil submit --
  // lihat app/api/session/claim). Dipakai lib/user-context.tsx untuk mendeteksi apakah
  // sesi browser ini sudah "digantikan" oleh login baru di browser/perangkat lain.
  active_session_token: string | null
  // Kapan akun ini dibuat -- ditampilkan di tab Akun halaman Profil sebagai "Bergabung Sejak".
  created_at: string
  nama_lengkap: string
  no_hp: string | null
  foto_url: string | null
  avatar_url: string | null
  is_active: boolean
  desa_id: string | null
  kelompok_id: string | null
  role_id: string | null
  role: {
    id: string
    nama_role: string
    tingkatan: Tingkatan
  } | null
  desa: {
    id: string
    nama_desa: string
  } | null
  kelompok: {
    id: string
    nama_kelompok: string
  } | null
}

export type KelasNgaji = 'pra_remaja' | 'remaja_muda' | 'remaja_dewasa'

export interface Generus {
  id: string
  nomor_generus: string
  nama_lengkap: string
  nama_panggilan: string | null
  tanggal_lahir: string | null
  jenis_kelamin: 'laki-laki' | 'perempuan' | null
  alamat: string | null
  no_hp: string | null
  tinggi_badan: number | null
  berat_badan: number | null
  kelas_ngaji: KelasNgaji | null
  kelompok_id: string | null
  desa_id: string | null
  foto_url: string | null
  status: 'aktif' | 'non-aktif'
  created_at: string
}

export interface Kegiatan {
  id: string
  nama_kegiatan: string
  deskripsi: string | null
  tanggal_mulai: string | null
  tanggal_selesai: string | null
  lokasi: string | null
  tingkatan: 'daerah' | 'desa' | 'kelompok' | null
  desa_id: string | null
  kelompok_id: string | null
  dibuat_oleh: string | null
  status: 'upcoming' | 'ongoing' | 'selesai'
  created_at: string
  kode_kegiatan: string | null
  kode_presensi_aktif: string | null
  kode_presensi_expired_at: string | null
  status_approval: StatusApproval
  approved_by: string | null
  approved_at: string | null
  catatan_ppg: string | null
}

export interface Keuangan {
  id: string
  jenis: 'pemasukan' | 'pengeluaran'
  kategori: string | null
  jumlah: number
  deskripsi: string | null
  tanggal: string
  tingkatan: 'daerah' | 'desa' | 'kelompok' | null
  desa_id: string | null
  kelompok_id: string | null
  dibuat_oleh: string | null
  bukti_url: string | null
  created_at: string
  nomor_transaksi: string | null
}

export interface PengajuanReimbursement {
  id: string
  nomor_pengajuan: string | null
  kategori: string | null
  jumlah: number
  deskripsi: string
  tanggal: string
  bukti_url: string | null
  tingkatan: 'daerah' | 'desa' | 'kelompok'
  desa_id: string | null
  kelompok_id: string | null
  diajukan_oleh: string
  status: 'menunggu' | 'disetujui' | 'ditolak'
  catatan_bendahara: string | null
  diproses_oleh: string | null
  diproses_at: string | null
  keuangan_id: string | null
  created_at: string
  // Relasi opsional (di-join saat query utk tampilan -- nama pengaju/pemroses)
  pengaju?: { nama_lengkap: string } | null
}

export interface Pengumuman {
  id: string
  judul: string
  isi: string
  tingkatan: 'semua' | 'daerah' | 'desa' | 'kelompok' | null
  desa_id: string | null
  kelompok_id: string | null
  dibuat_oleh: string | null
  tanggal_publish: string
  is_active: boolean
  created_at: string
  status_approval: StatusApproval
  approved_by: string | null
  approved_at: string | null
  catatan_ppg: string | null
}

export interface CatatanPembinaan {
  id: string
  dibuat_oleh: string
  target_desa_id: string | null
  target_kelompok_id: string | null
  judul: string
  isi: string
  created_at: string
  desa?: { id: string; nama_desa: string } | null
  kelompok?: { id: string; nama_kelompok: string } | null
}

export interface Absensi {
  id: string
  kegiatan_id: string | null
  generus_id: string | null
  status: 'hadir' | 'tidak_hadir' | 'izin' | 'sakit' | null
  keterangan: string | null
  waktu_absen: string | null
  created_at: string | null
  dikoreksi_oleh?: string | null
  dikoreksi_at?: string | null
  status_sebelum_koreksi?: string | null
  generus?: {
    id: string
    nama_lengkap: string
    nomor_generus: string
    kelompok_id: string | null
    desa_id: string | null
  } | null
  kegiatan?: {
    id: string
    nama_kegiatan: string
  } | null
}

export interface Notifikasi {
  id: number
  judul: string
  pesan: string
  tipe: string
  target_role: string
  target_user: string | null
  is_read: boolean
  read_at: string | null
  created_by: string | null
  link: string | null
  created_at: string
}

// Selaras CHECK constraint email_log_tipe_check di database. 'reset_password' dipakai alur
// reset password (app/api/reset-password-requests/route.ts), 'maintenance' dipakai trigger
// trg_notify_email_maintenance saat Mode Perawatan Sistem diaktifkan/dinonaktifkan.
export type EmailTipe = 'pengumuman' | 'kegiatan' | 'reminder' | 'approval_ppg' | 'reset_password' | 'maintenance' | 'maintenance_scheduled'
export type EmailStatus = 'pending' | 'sent' | 'failed'

export interface EmailLog {
  id: string
  recipient: string
  recipient_user_id: string | null
  subject: string
  tipe: EmailTipe
  reference_id: string | null
  status: EmailStatus
  error_message: string | null
  created_at: string
  sent_at: string | null
}

export interface EmailPreferensi {
  user_id: string
  pengumuman: boolean
  kegiatan: boolean
  reminder: boolean
  approval_ppg: boolean
  updated_at: string
}

export interface AuditLog {
  id: number
  user_id: string | null
  user_email: string | null
  user_role: string | null
  action: string
  module: string | null
  target_id: string | null
  target_desc: string | null
  detail: Record<string, unknown>
  ip_address: string | null
  status: string
  created_at: string
  desa_id: string | null
  kelompok_id: string | null
}

export type ResetPasswordStatus = 'pending' | 'processed' | 'ditolak'

// Permintaan reset password diajukan oleh siapapun (bahkan yang belum login, lewat halaman
// publik /lupa-password) dan hanya boleh dilihat/diproses oleh Super Admin -- lihat RLS
// reset_request_insert (public) & reset_request_superadmin (ALL, hanya super_admin).
export interface ResetPasswordRequest {
  id: number
  email: string
  nama: string
  status: ResetPasswordStatus
  created_at: string
  processed_at: string | null
  processed_by: string | null
  notes: string | null
}

// Baris tunggal konfigurasi teknis sistem (id selalu `true`) -- dipakai fitur Mode Perawatan
// Sistem. RLS: SELECT terbuka untuk semua user terautentikasi (supaya layout.tsx bisa
// redirect ke /maintenance untuk role manapun), UPDATE hanya super_admin.
// scheduled_activation_at diisi saat Super Admin memilih "Jadwalkan Perawatan" (delay,
// bukan langsung aktif) -- dicek oleh polling client (layout.tsx & /maintenance) yang akan
// otomatis mengaktifkan maintenance_mode begitu waktu ini terlewati.
export interface SystemConfig {
  id: true
  maintenance_mode: boolean
  maintenance_message: string | null
  maintenance_started_at: string | null
  maintenance_started_by: string | null
  scheduled_activation_at: string | null
  scheduled_message: string | null
  scheduled_by: string | null
  updated_at: string
}
