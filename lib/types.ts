export type Tingkatan = 'super_admin' | 'daerah' | 'desa' | 'kelompok'

export interface UserProfile {
  id: string
  email: string
  nama_lengkap: string
  no_hp: string | null
  foto_url: string | null
  is_active: boolean
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
}
