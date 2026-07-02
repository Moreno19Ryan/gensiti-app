export type Tingkatan = 'super_admin' | 'daerah' | 'desa' | 'kelompok' | 'ppg'

export type StatusApproval = 'menunggu_ppg' | 'disetujui' | 'ditolak'

export interface UserProfile {
  id: string
  email: string
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

export interface Anggota {
  id: string
  nomor_anggota: string
  nama_lengkap: string
  tanggal_lahir: string | null
  jenis_kelamin: 'laki-laki' | 'perempuan' | null
  alamat: string | null
  no_hp: string | null
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
  anggota_id: string | null
  status: 'hadir' | 'tidak_hadir' | 'izin' | 'sakit' | null
  keterangan: string | null
  waktu_absen: string | null
  created_at: string | null
  anggota?: {
    id: string
    nama_lengkap: string
    nomor_anggota: string
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

export type EmailTipe = 'pengumuman' | 'kegiatan' | 'reminder' | 'approval_ppg'
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
