'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import Modal from '@/components/Modal'
import { Tingkatan } from '@/lib/types'

// Halaman "Administrasi Sistem" -- khusus Super Admin, murni fungsi teknis pengelolaan
// sistem (bukan data organisasi/keuangan), digabung jadi 1 menu sidebar dengan 3 tab supaya
// sidebar tidak makin panjang:
// 1. Role: CRUD master data roles (nama_role, tingkatan, deskripsi)
// 2. Kesehatan Sistem: ringkasan teknis (jumlah user per role, error rate email, sesi aktif)
// 3. Sesi Aktif: lihat & paksa logout sesi user tertentu (kosongkan active_session_token)
//
// Route ini SENGAJA terpisah dari /organisasi (yang mengelola Desa/Kelompok -- struktur
// ORGANISASI) karena tiga fitur di sini murni administrasi TEKNIS sistem, bukan struktur
// organisasi. Baik /organisasi maupun /admin-sistem sama-sama eksklusif Super Admin.

type Tab = 'role' | 'kesehatan' | 'sesi'

interface RoleRow {
  id: string
  nama_role: string
  tingkatan: Tingkatan
  deskripsi: string | null
  created_at: string
  _userCount?: number
}

const TINGKATAN_OPTIONS: { value: Tingkatan; label: string }[] = [
  { value: 'daerah', label: 'Daerah' },
  { value: 'desa', label: 'Desa' },
  { value: 'kelompok', label: 'Kelompok' },
  { value: 'ppg', label: 'PPG' },
  // 'super_admin' SENGAJA TIDAK ada di opsi -- Super Admin adalah akun tunggal & mutlak,
  // tidak boleh ada role baru bertingkatan ini dibuat lewat UI manapun (konsisten dengan
  // proteksi isSuperAdminRole() di app/api/users/route.ts).
]

const tingkatanColor: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  daerah: 'bg-purple-100 text-purple-700',
  desa: 'bg-blue-100 text-blue-700',
  kelompok: 'bg-green-100 text-green-700',
  ppg: 'bg-amber-100 text-amber-700',
}

interface SessionRow {
  id: string
  nama_lengkap: string
  email: string
  login_username: string | null
  is_active: boolean
  active_session_created_at: string | null
  roles: { nama_role: string; tingkatan: string } | null
}

interface HealthStats {
  userByTingkatan: { tingkatan: string; label: string; count: number }[]
  totalUserAktif: number
  totalUserNonaktif: number
  emailSent: number
  emailFailed: number
  emailPending: number
  sesiAktifCount: number
}

export default function AdminSistemPage() {
  const { user } = useUser()
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('role')

  useEffect(() => {
    if (!user) return
    if (user.role?.tingkatan !== 'super_admin') router.replace('/dashboard')
  }, [user, router])

  if (!user || user.role?.tingkatan !== 'super_admin') return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Administrasi Sistem</h2>
        <p className="text-slate-400 text-sm">Kelola role, pantau kesehatan sistem, dan kelola sesi login pengguna</p>
      </div>

      <div className="flex gap-1 bg-white border border-slate-100 p-1 rounded-xl shadow-sm w-fit overflow-x-auto">
        {([
          { key: 'role', label: '🎭 Role' },
          { key: 'kesehatan', label: '💡 Kesehatan Sistem' },
          { key: 'sesi', label: '🔐 Sesi Aktif' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'role' && <RoleTab user={user} />}
      {tab === 'kesehatan' && <KesehatanTab />}
      {tab === 'sesi' && <SesiTab user={user} />}
    </div>
  )
}

// ============================= TAB 1: ROLE =============================

function RoleTab({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const [roles, setRoles] = useState<RoleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<RoleRow | null>(null)
  const [form, setForm] = useState({ nama_role: '', tingkatan: 'kelompok' as Tingkatan, deskripsi: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const loadRoles = useCallback(async () => {
    setLoading(true)
    const { data: roleRows, error: err } = await supabase.from('roles').select('*').order('tingkatan').order('nama_role')
    if (err) { console.error('Roles load error:', err); setLoading(false); return }

    // Hitung jumlah user per role (untuk validasi hapus & informasi di UI) -- 1 query
    // count per role lebih sederhana daripada agregasi manual dari seluruh tabel users.
    const withCounts = await Promise.all(
      (roleRows || []).map(async (r) => {
        const { count } = await supabase.from('users').select('id', { count: 'exact', head: true }).eq('role_id', r.id)
        return { ...r, _userCount: count || 0 } as RoleRow
      })
    )
    setRoles(withCounts)
    setLoading(false)
  }, [])

  useEffect(() => { loadRoles() }, [loadRoles])

  const openAdd = () => {
    setEditTarget(null)
    setError('')
    setForm({ nama_role: '', tingkatan: 'kelompok', deskripsi: '' })
    setModalOpen(true)
  }

  const openEdit = (r: RoleRow) => {
    setEditTarget(r)
    setError('')
    setForm({ nama_role: r.nama_role, tingkatan: r.tingkatan, deskripsi: r.deskripsi || '' })
    setModalOpen(true)
  }

  const save = async () => {
    setError('')
    if (!form.nama_role.trim()) { setError('Nama role wajib diisi'); return }

    // Proteksi tambahan di client (selain CHECK constraint & TINGKATAN_OPTIONS yang sudah
    // membatasi pilihan) -- kalau suatu saat ada cara lain nilai 'super_admin' lolos ke form
    // ini, tetap ditolak eksplisit di sini sebelum sempat dikirim ke database.
    if ((form.tingkatan as string) === 'super_admin') {
      setError('Tidak dapat membuat/mengubah role menjadi tingkatan Super Admin -- akun ini bersifat tunggal & mutlak.')
      return
    }

    setSaving(true)
    try {
      const payload = { nama_role: form.nama_role.trim(), tingkatan: form.tingkatan, deskripsi: form.deskripsi.trim() || null }
      if (editTarget) {
        const { error: err } = await supabase.from('roles').update(payload).eq('id', editTarget.id)
        if (err) { setError(err.message); return }
        await logAudit(user, 'UPDATE', 'Administrasi Sistem - Role', form.nama_role, payload, editTarget.id)
      } else {
        const { data: inserted, error: err } = await supabase.from('roles').insert(payload).select('id').single()
        if (err) { setError(err.message); return }
        await logAudit(user, 'CREATE', 'Administrasi Sistem - Role', form.nama_role, payload, inserted?.id)
      }
      setModalOpen(false)
      loadRoles()
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleteError('')
    if (deleteTarget._userCount && deleteTarget._userCount > 0) {
      setDeleteError(`Tidak dapat menghapus -- masih dipakai oleh ${deleteTarget._userCount} pengguna. Pindahkan pengguna tsb ke role lain terlebih dahulu.`)
      return
    }
    setDeleting(true)
    try {
      const { error: err } = await supabase.from('roles').delete().eq('id', deleteTarget.id)
      if (err) { setDeleteError(err.message); return }
      await logAudit(user, 'DELETE', 'Administrasi Sistem - Role', deleteTarget.nama_role, {}, deleteTarget.id)
      setDeleteTarget(null)
      loadRoles()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
          + Tambah Role
        </button>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 font-medium">Nama Role</th>
                <th className="px-4 py-3 font-medium">Tingkatan</th>
                <th className="px-4 py-3 font-medium">Deskripsi</th>
                <th className="px-4 py-3 font-medium">Pengguna</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.nama_role}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[r.tingkatan] || 'bg-slate-100 text-slate-500'}`}>
                      {r.tingkatan}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate" title={r.deskripsi || ''}>{r.deskripsi || '-'}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{r._userCount ?? '-'} pengguna</td>
                  <td className="px-4 py-3">
                    {r.tingkatan === 'super_admin' ? (
                      <span className="text-xs text-slate-300 italic">Permanen (sistem)</span>
                    ) : (
                      <div className="flex gap-3">
                        <button onClick={() => openEdit(r)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                        <button onClick={() => { setDeleteTarget(r); setDeleteError('') }} className="text-red-500 hover:text-red-700 text-xs font-medium">Hapus</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Tambah/Edit */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? `Edit Role: ${editTarget.nama_role}` : 'Tambah Role'} size="sm">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama Role *</label>
            <input value={form.nama_role} onChange={e => setForm(f => ({ ...f, nama_role: e.target.value }))}
              placeholder="mis. Bendahara"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Tingkatan *</label>
            <select value={form.tingkatan} onChange={e => setForm(f => ({ ...f, tingkatan: e.target.value as Tingkatan }))}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TINGKATAN_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">Menentukan jenjang/scope kewenangan pemegang role ini.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi</label>
            <textarea value={form.deskripsi} onChange={e => setForm(f => ({ ...f, deskripsi: e.target.value }))}
              rows={2} placeholder="Opsional -- keterangan singkat tugas role ini"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={save} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal Konfirmasi Hapus */}
      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Hapus Role?" size="sm">
        <div className="space-y-4">
          {deleteError && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{deleteError}</div>}
          <p className="text-sm text-slate-600">
            Yakin ingin menghapus role <strong>{deleteTarget?.nama_role}</strong>?
            {deleteTarget?._userCount ? ` Role ini masih dipakai oleh ${deleteTarget._userCount} pengguna.` : ' Aksi ini tidak dapat dibatalkan.'}
          </p>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setDeleteTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={confirmDelete} disabled={deleting || !!(deleteTarget?._userCount)}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {deleting ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Hapus'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

// ============================= TAB 2: KESEHATAN SISTEM =============================

function KesehatanTab() {
  const [stats, setStats] = useState<HealthStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: roleAgg }, { count: userAktif }, { count: userNonaktif }, { data: emailAgg }, { count: sesiAktif }] = await Promise.all([
        // Jumlah user per tingkatan role -- via join manual karena PostgREST tidak
        // mendukung GROUP BY langsung; jumlah baris di tabel roles/users kecil (organisasi
        // kekeluargaan), jadi agregasi di client tidak masalah secara performa.
        supabase.from('users').select('roles:role_id(tingkatan, nama_role)').eq('is_active', true),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', false),
        supabase.from('email_log').select('status'),
        // Sesi aktif = user yang punya active_session_token terisi (pernah login lewat
        // form sejak fitur single-session ada) DAN akunnya masih aktif.
        supabase.from('users').select('id', { count: 'exact', head: true }).not('active_session_token', 'is', null).eq('is_active', true),
      ])

      const tingkatanLabel: Record<string, string> = { super_admin: 'Super Admin', daerah: 'Daerah', desa: 'Desa', kelompok: 'Kelompok', ppg: 'PPG' }
      const countMap = new Map<string, number>()
      ;(roleAgg as unknown as { roles: { tingkatan: string } | null }[] | null)?.forEach(row => {
        const t = row.roles?.tingkatan
        if (!t) return
        countMap.set(t, (countMap.get(t) || 0) + 1)
      })
      const userByTingkatan = Object.keys(tingkatanLabel).map(t => ({
        tingkatan: t,
        label: tingkatanLabel[t],
        count: countMap.get(t) || 0,
      }))

      const emailRows = emailAgg || []
      const emailSent = emailRows.filter(r => r.status === 'sent').length
      const emailFailed = emailRows.filter(r => r.status === 'failed').length
      const emailPending = emailRows.filter(r => r.status === 'pending').length

      setStats({
        userByTingkatan,
        totalUserAktif: userAktif || 0,
        totalUserNonaktif: userNonaktif || 0,
        emailSent,
        emailFailed,
        emailPending,
        sesiAktifCount: sesiAktif || 0,
      })
    } catch (err) {
      console.error('Gagal memuat kesehatan sistem:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading || !stats) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const emailTotal = stats.emailSent + stats.emailFailed + stats.emailPending
  const emailErrorRate = emailTotal > 0 ? Math.round((stats.emailFailed / emailTotal) * 100) : 0

  return (
    <div className="space-y-4">
      {/* Ringkasan utama */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-blue-600">{stats.totalUserAktif}</div>
          <div className="text-slate-500 text-sm">Pengguna Aktif</div>
          <div className="text-slate-400 text-xs">{stats.totalUserNonaktif} nonaktif</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-emerald-600">{stats.sesiAktifCount}</div>
          <div className="text-slate-500 text-sm">Sesi Login Aktif</div>
          <div className="text-slate-400 text-xs">via form login</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className={`text-2xl font-black ${emailErrorRate > 10 ? 'text-red-600' : emailErrorRate > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{emailErrorRate}%</div>
          <div className="text-slate-500 text-sm">Error Rate Email</div>
          <div className="text-slate-400 text-xs">{stats.emailFailed} gagal dari {emailTotal}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-amber-600">{stats.emailPending}</div>
          <div className="text-slate-500 text-sm">Email Menunggu</div>
          <div className="text-slate-400 text-xs">status pending</div>
        </div>
      </div>

      {/* Distribusi user per tingkatan */}
      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-700 mb-1">Distribusi Pengguna Aktif per Tingkatan</h3>
        <p className="text-slate-400 text-xs mb-4">Jumlah pengguna aktif dikelompokkan berdasarkan jenjang role</p>
        <div className="space-y-2">
          {stats.userByTingkatan.map(row => {
            const max = Math.max(...stats.userByTingkatan.map(r => r.count), 1)
            const pct = Math.round((row.count / max) * 100)
            return (
              <div key={row.tingkatan} className="flex items-center gap-3">
                <span className="w-24 text-xs text-slate-500 shrink-0">{row.label}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${tingkatanColor[row.tingkatan]?.split(' ')[0].replace('100', '500') || 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right text-xs font-semibold text-slate-700">{row.count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
        💡 Halaman ini menampilkan indikator teknis murni (jumlah akun, status sesi, keberhasilan pengiriman email) -- bukan data organisasi atau keuangan, sesuai cakupan wewenang Super Admin sebagai pengelola sistem.
      </div>
    </div>
  )
}

// ============================= TAB 3: SESI AKTIF =============================

function SesiTab({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<SessionRow | null>(null)
  const [processing, setProcessing] = useState(false)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('id, nama_lengkap, email, login_username, is_active, active_session_created_at, roles:role_id(nama_role, tingkatan)')
      .not('active_session_token', 'is', null)
      .eq('is_active', true)
      .order('active_session_created_at', { ascending: false })
    if (error) console.error('Sesi load error:', error)
    setRows((data as unknown as SessionRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const paksaLogout = async () => {
    if (!confirmTarget) return
    setProcessing(true)
    try {
      // Mengosongkan active_session_token -- TIDAK menonaktifkan akun (is_active tetap
      // apa adanya). User yang bersangkutan akan otomatis logout di perangkat manapun
      // dalam waktu singkat, dideteksi oleh polling 30 detik di lib/user-context.tsx
      // (checkSessionMasihValid: localToken browser tidak lagi cocok dgn token DB yg
      // sekarang NULL) atau saat dia reload/navigasi halaman.
      const { error } = await supabase
        .from('users')
        .update({ active_session_token: null })
        .eq('id', confirmTarget.id)
      if (error) { console.error('Gagal paksa logout:', error); return }
      await logAudit(user, 'UPDATE', 'Administrasi Sistem - Sesi Aktif', `Paksa logout: ${confirmTarget.nama_lengkap}`, {}, confirmTarget.id)
      setConfirmTarget(null)
      loadSessions()
    } finally {
      setProcessing(false)
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !search || r.nama_lengkap?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q) || r.login_username?.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-3">
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
        💡 Daftar ini hanya menampilkan pengguna yang pernah login lewat form login sejak fitur sesi tunggal aktif. Paksa logout akan mengosongkan sesi tersebut -- pengguna otomatis keluar di perangkat manapun dalam waktu singkat, TANPA menonaktifkan akunnya.
      </div>

      <input type="text" placeholder="Cari nama, email, atau nama pengguna..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />

      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔐</div>
          <p>Tidak ada sesi login aktif ditemukan</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 font-medium">Pengguna</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Login Terakhir</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{r.nama_lengkap}</div>
                    <div className="text-slate-400 text-xs">{r.login_username || r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[r.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                      {r.roles?.nama_role || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {r.active_session_created_at
                      ? new Date(r.active_session_created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setConfirmTarget(r)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                      Paksa Logout
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!confirmTarget} onClose={() => setConfirmTarget(null)} title="Paksa Logout Sesi?" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Sesi login <strong>{confirmTarget?.nama_lengkap}</strong> akan dikosongkan. Akunnya TIDAK dinonaktifkan -- yang bersangkutan bisa login kembali kapan saja lewat form login.
          </p>
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setConfirmTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={paksaLogout} disabled={processing}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {processing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Ya, Paksa Logout'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
