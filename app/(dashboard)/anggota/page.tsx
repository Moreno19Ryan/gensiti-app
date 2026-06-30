'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import Modal from '@/components/Modal'

interface Member {
  id: string
  email: string
  nama_lengkap: string
  no_hp: string | null
  is_active: boolean
  is_archived: boolean
  alasan_arsip: string | null
  created_at: string
  desa_id: string | null
  kelompok_id: string | null
  role_id: string | null
  roles: { id: string; nama_role: string; tingkatan: string } | null
  desa: { id: string; nama_desa: string } | null
  kelompok: { id: string; nama_kelompok: string } | null
  anggota: {
    id: string
    nomor_anggota: string
    tanggal_lahir: string | null
    tempat_lahir: string | null
    jenis_kelamin: string | null
    alamat: string | null
    nama_ayah: string | null
    nama_ibu: string | null
    nama_wali: string | null
    no_hp_orangtua_wali: string | null
    nama_orang_tua: string | null
    no_hp_orang_tua: string | null
    status: string
    status_pengguna: string | null
    pindah_desa_id: string | null
    pindah_kelompok_id: string | null
    pindah_ke_daerah_lain: boolean | null
    anak_ke: number | null
    jumlah_saudara: number | null
  }[] | null
}

interface RoleOpt { id: string; nama_role: string; tingkatan: string }
interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const emptyForm = {
  email: '',
  password: '',
  nama_lengkap: '',
  no_hp: '',
  role_id: '',
  desa_id: '',
  kelompok_id: '',
  is_active: true,
  tempat_lahir: '',
  tanggal_lahir: '',
  jenis_kelamin: '',
  alamat: '',
  status_anggota: 'aktif',
  nama_ayah: '',
  nama_ibu: '',
  nama_wali: '',
  no_hp_orangtua_wali: '',
  status_pengguna: 'lajang',
  pindah_jenis: 'bekasi_timur',
  pindah_desa_id: '',
  pindah_kelompok_id: '',
  anak_ke: '',
  jumlah_saudara: '',
}

const statusPenggunaBadge: Record<string, string> = {
  lajang: 'bg-blue-100 text-blue-700',
  menikah: 'bg-emerald-100 text-emerald-700',
  pindah_sambung: 'bg-amber-100 text-amber-700',
  meninggal_dunia: 'bg-slate-100 text-slate-600',
}

const statusPenggunaLabel: Record<string, string> = {
  lajang: 'Lajang',
  menikah: 'Menikah',
  pindah_sambung: 'Pindah Sambung',
  meninggal_dunia: 'Meninggal Dunia',
}

const tingkatanColor: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  daerah: 'bg-purple-100 text-purple-700',
  desa: 'bg-blue-100 text-blue-700',
  kelompok: 'bg-green-100 text-green-700',
}

const toUpperWords = (str: string) => str.toUpperCase()

type ConfirmType = 'menikah' | 'meninggal_dunia' | 'pindah_luar'

const confirmMessages: Record<ConfirmType, { title: string; step1: string; step2: (name: string) => string }> = {
  menikah: {
    title: 'Konfirmasi Perubahan Status',
    step1: 'Pengguna ini akan berstatus "Menikah". Akunnya akan dinonaktifkan dan diarsipkan. Lanjutkan?',
    step2: (name) => `Konfirmasi akhir: Akun "${name}" akan dinonaktifkan dan dipindahkan ke arsip. Aksi ini tidak dapat dibatalkan.`,
  },
  meninggal_dunia: {
    title: 'Konfirmasi Perubahan Status',
    step1: 'Pengguna ini akan berstatus "Meninggal Dunia". Akunnya akan dinonaktifkan dan diarsipkan. Lanjutkan?',
    step2: (name) => `Konfirmasi akhir: Akun "${name}" akan dinonaktifkan dan dipindahkan ke arsip. Aksi ini tidak dapat dibatalkan.`,
  },
  pindah_luar: {
    title: 'Konfirmasi Pindah Sambung',
    step1: 'Pengguna ini pindah sambung ke daerah lain. Akunnya akan diarsipkan. Untuk mengaktifkan kembali harus mengajukan ke Ketua Muda-Mudi Daerah. Lanjutkan?',
    step2: (name) => `Konfirmasi akhir: Akun "${name}" akan dinonaktifkan dan diarsipkan. Hanya dapat diaktifkan kembali oleh Ketua Daerah. Yakin?`,
  },
}

export default function PenggunaPage() {
  const { user } = useUser()
  const [data, setData] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [sortBy, setSortBy] = useState<'nama_asc' | 'nama_desc' | 'terbaru'>('nama_asc')
  const [modalOpen, setModalOpen] = useState(false)
  const [detailModal, setDetailModal] = useState<Member | null>(null)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [roleList, setRoleList] = useState<RoleOpt[]>([])
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [activeTab, setActiveTab] = useState<'info' | 'akun'>('info')
  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1)
  const [confirmType, setConfirmType] = useState<ConfirmType | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('users')
      .select(`
        id, email, nama_lengkap, no_hp, is_active, is_archived, alasan_arsip, created_at, desa_id, kelompok_id, role_id,
        roles:role_id(id, nama_role, tingkatan),
        desa:desa_id(id, nama_desa),
        kelompok:kelompok_id(id, nama_kelompok),
        anggota(id, nomor_anggota, tanggal_lahir, tempat_lahir, jenis_kelamin, alamat, nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali, nama_orang_tua, no_hp_orang_tua, status, status_pengguna, pindah_desa_id, pindah_kelompok_id, pindah_ke_daerah_lain, anak_ke, jumlah_saudara)
      `)
      .order('nama_lengkap')

    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    // Sembunyikan akun super_admin dari daftar anggota
    query = query.not('roles.tingkatan', 'eq', 'super_admin')

    const { data: rows, error: err } = await query
    if (err) console.error('Pengguna load error:', err)
    // Filter tambahan di client: pastikan super_admin tidak tampil
    const filtered = (rows as unknown as Member[])?.filter(
      m => m.roles?.tingkatan !== 'super_admin'
    ) || []
    setData(filtered)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    loadData()
    Promise.all([
      supabase.from('roles').select('id, nama_role, tingkatan').order('nama_role'),
      supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
      supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
    ]).then(([{ data: r }, { data: d }, { data: k }]) => {
      setRoleList((r as unknown as RoleOpt[]) || [])
      setDesaList(d || [])
      setKelompokList((k as unknown as KelompokOpt[]) || [])
    })
  }, [user, loadData])

  const openAdd = () => {
    setEditTarget(null)
    setActiveTab('info')
    setError('')
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (m: Member) => {
    setEditTarget(m)
    setActiveTab('info')
    setError('')
    const a = m.anggota?.[0]
    setForm({
      email: m.email,
      password: '',
      nama_lengkap: m.nama_lengkap,
      no_hp: m.no_hp || '',
      role_id: m.roles?.id || '',
      desa_id: m.desa?.id || '',
      kelompok_id: m.kelompok?.id || '',
      is_active: m.is_active,
      tempat_lahir: a?.tempat_lahir || '',
      tanggal_lahir: a?.tanggal_lahir || '',
      jenis_kelamin: a?.jenis_kelamin || '',
      alamat: a?.alamat || '',
      status_anggota: a?.status || 'aktif',
      nama_ayah: a?.nama_ayah || a?.nama_orang_tua || '',
      nama_ibu: a?.nama_ibu || '',
      nama_wali: a?.nama_wali || '',
      no_hp_orangtua_wali: a?.no_hp_orangtua_wali || a?.no_hp_orang_tua || '',
      status_pengguna: a?.status_pengguna || 'lajang',
      pindah_jenis: a?.pindah_ke_daerah_lain ? 'daerah_lain' : 'bekasi_timur',
      pindah_desa_id: a?.pindah_desa_id || '',
      pindah_kelompok_id: a?.pindah_kelompok_id || '',
      anak_ke: a?.anak_ke?.toString() || '',
      jumlah_saudara: a?.jumlah_saudara?.toString() || '',
    })
    setModalOpen(true)
  }

  const doActualSave = async () => {
    setSaving(true)
    try {
      const needsArchive = !!editTarget && (
        form.status_pengguna === 'menikah' ||
        form.status_pengguna === 'meninggal_dunia' ||
        (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain')
      )

      const anggotaFields = {
        tempat_lahir: form.tempat_lahir,
        tanggal_lahir: form.tanggal_lahir,
        jenis_kelamin: form.jenis_kelamin,
        alamat: form.alamat,
        status_anggota: form.status_anggota,
        nama_ayah: form.nama_ayah,
        nama_ibu: form.nama_ibu,
        nama_wali: form.nama_wali || null,
        no_hp_orangtua_wali: form.no_hp_orangtua_wali,
        status_pengguna: form.status_pengguna,
        pindah_desa_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_desa_id || null : null,
        pindah_kelompok_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_kelompok_id || null : null,
        pindah_ke_daerah_lain: form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain',
        anak_ke: form.anak_ke ? parseInt(form.anak_ke) : null,
        jumlah_saudara: form.jumlah_saudara ? parseInt(form.jumlah_saudara) : null,
      }

      let userId = editTarget?.id

      if (!editTarget) {
        const res = await fetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email,
            password: form.password,
            nama_lengkap: form.nama_lengkap,
            no_hp: form.no_hp,
            role_id: form.role_id,
            desa_id: form.desa_id,
            kelompok_id: form.kelompok_id,
            ...anggotaFields,
          }),
        })
        const json = await res.json()
        if (json.error) { setError(json.error); return }
        userId = json.userId
      } else {
        const existingAnggota = editTarget.anggota?.[0]

        // Pindah sambung Bekasi Timur: update desa/kelompok ke tujuan baru
        const targetDesaId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_desa_id)
          ? form.pindah_desa_id
          : form.desa_id
        const targetKelompokId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_kelompok_id)
          ? form.pindah_kelompok_id
          : form.kelompok_id

        const body: Record<string, unknown> = {
          id: editTarget.id,
          nama_lengkap: form.nama_lengkap,
          no_hp: form.no_hp,
          role_id: form.role_id,
          desa_id: targetDesaId,
          kelompok_id: targetKelompokId,
          is_active: needsArchive ? false : form.is_active,
          password: form.password || undefined,
          anggota_id: existingAnggota?.id,
          ...anggotaFields,
        }

        if (needsArchive) {
          const alasan =
            form.status_pengguna === 'menikah' ? 'Menikah' :
            form.status_pengguna === 'meninggal_dunia' ? 'Meninggal Dunia' :
            'Pindah Sambung ke Daerah Lain'
          body.archive = true
          body.alasan_arsip = alasan
        }

        const res = await fetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json()
        if (json.error) { setError(json.error); return }
      }

      if (user) {
        await logAudit(
          user,
          editTarget ? 'UPDATE' : 'CREATE',
          'Pengguna',
          form.nama_lengkap,
          { email: form.email, role_id: form.role_id, status_pengguna: form.status_pengguna },
          userId
        )
      }

      setModalOpen(false)
      setConfirmOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    setError('')
    if (!form.nama_lengkap) { setError('Nama lengkap wajib diisi'); return }
    if (!editTarget && (!form.email || !form.password)) { setError('Email dan password wajib untuk pengguna baru'); return }
    if (!form.tempat_lahir) { setError('Tempat lahir wajib diisi'); return }
    if (!form.tanggal_lahir) { setError('Tanggal lahir wajib diisi'); return }
    if (!form.jenis_kelamin) { setError('Jenis kelamin wajib diisi'); return }
    if (!form.alamat) { setError('Alamat wajib diisi'); return }
    if (!form.nama_ayah) { setError('Nama ayah kandung wajib diisi'); return }
    if (!form.nama_ibu) { setError('Nama ibu kandung wajib diisi'); return }
    if (!form.no_hp_orangtua_wali) { setError('No. HP orang tua/wali wajib diisi'); return }

    // Validasi pindah sambung Bekasi Timur
    if (editTarget && form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') {
      if (!form.pindah_desa_id) { setError('Pilih desa tujuan pindah sambung'); setActiveTab('info'); return }
      if (!form.pindah_kelompok_id) { setError('Pilih kelompok tujuan pindah sambung'); setActiveTab('info'); return }
    }

    // Cek apakah perlu arsip → tampilkan konfirmasi
    const needsArchive = !!editTarget && (
      form.status_pengguna === 'menikah' ||
      form.status_pengguna === 'meninggal_dunia' ||
      (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain')
    )

    if (needsArchive) {
      const type: ConfirmType =
        form.status_pengguna === 'menikah' ? 'menikah' :
        form.status_pengguna === 'meninggal_dunia' ? 'meninggal_dunia' :
        'pindah_luar'
      setConfirmType(type)
      setConfirmStep(1)
      setConfirmOpen(true)
      return
    }

    await doActualSave()
  }

  const toggleActive = async (m: Member) => {
    if (m.roles?.tingkatan === 'super_admin') {
      alert('Akun Super Admin tidak dapat dinonaktifkan.')
      return
    }
    await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, nama_lengkap: m.nama_lengkap, is_active: !m.is_active }),
    })
    if (user) {
      await logAudit(user, m.is_active ? 'DEACTIVATE' : 'ACTIVATE', 'Pengguna', m.nama_lengkap, {}, m.id)
    }
    loadData()
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))
  const setUpper = (key: string, val: string) => setForm(f => ({ ...f, [key]: toUpperWords(val) }))

  const filtered = data
    .filter(m => {
      const q = search.toLowerCase()
      const matchSearch = !search ||
        m.nama_lengkap?.toLowerCase().includes(q) ||
        m.email?.toLowerCase().includes(q) ||
        m.anggota?.[0]?.nomor_anggota?.toLowerCase().includes(q) ||
        m.desa?.nama_desa?.toLowerCase().includes(q) ||
        m.kelompok?.nama_kelompok?.toLowerCase().includes(q)
      const matchRole = !filterRole || m.roles?.tingkatan === filterRole
      return matchSearch && matchRole
    })
    .sort((a, b) => {
      if (sortBy === 'nama_asc') return (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '')
      if (sortBy === 'nama_desc') return (b.nama_lengkap || '').localeCompare(a.nama_lengkap || '')
      if (sortBy === 'terbaru') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return 0
    })

  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  // Hanya Ketua Muda-Mudi dan Wakil Ketua (semua scope) yang bisa mengelola anggota.
  // Role lain (Sekretaris, Bendahara, Kemandirian, Keputrian, dll) hanya bisa melihat daftar.
  const canManageMembers = isSuperAdmin || (
    !!user?.role && user.role.nama_role.toLowerCase().includes('ketua')
  )

  // Cek apakah user bisa edit/tambah member tertentu — hanya Ketua/Wakil sesuai scope
  const canActOn = (m: Member): boolean => {
    if (!canManageMembers) return false
    if (isSuperAdmin || user?.role?.tingkatan === 'daerah') return true
    if (user?.role?.tingkatan === 'desa') return m.desa_id === user?.desa_id
    if (user?.role?.tingkatan === 'kelompok') return m.kelompok_id === user?.kelompok_id
    return false
  }

  // Tombol Tambah Pengguna: hanya Ketua/Wakil Ketua/Super Admin
  const canManage = canManageMembers

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Pengguna</h2>
          <p className="text-slate-400 text-sm">{data.length} pengguna terdaftar</p>
        </div>
        {canManage && (
          <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            + Tambah Pengguna
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Cari nama, email, nomor anggota, desa..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="">Semua Role</option>
          
          <option value="daerah">Daerah</option>
          <option value="desa">Desa</option>
          <option value="kelompok">Kelompok</option>
        </select>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="nama_asc">Nama A–Z</option>
          <option value="nama_desc">Nama Z–A</option>
          <option value="terbaru">Terbaru</option>
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">👥</div>
          <p>Belum ada pengguna</p>
          {canManage && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Tambah sekarang</button>}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Pengguna</th>
                  <th className="px-4 py-3 font-medium">No. Anggota</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Desa / Kelompok</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const a = m.anggota?.[0]
                  const sp = a?.status_pengguna || 'lajang'
                  return (
                    <tr key={m.id} className={`border-b border-slate-50 hover:bg-slate-50 transition ${canActOn(m) ? 'cursor-pointer' : ''}`}
                      onClick={() => canActOn(m) && setDetailModal(m)}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
                            {m.nama_lengkap?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{m.nama_lengkap}</div>
                            <div className="text-slate-400 text-xs">{m.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{a?.nomor_anggota || '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[m.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                          {m.roles?.nama_role || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <div>{m.desa?.nama_desa || '—'}</div>
                        {m.kelompok && <div className="text-slate-400">{m.kelompok.nama_kelompok}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${m.is_archived ? 'bg-orange-100 text-orange-700' : m.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                            {m.is_archived ? 'Diarsipkan' : m.is_active ? 'Aktif' : 'Non-aktif'}
                          </span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${statusPenggunaBadge[sp] || 'bg-slate-100 text-slate-500'}`}>
                            {statusPenggunaLabel[sp] || sp}
                          </span>
                        </div>
                      </td>
                      {canActOn(m) && (
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex gap-3">
                            <button onClick={() => openEdit(m)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                            {isSuperAdmin && m.roles?.tingkatan !== 'super_admin' && !m.is_archived && (
                              <button onClick={() => toggleActive(m)} className={`text-xs font-medium ${m.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                                {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            )}
                            {m.roles?.tingkatan === 'super_admin' && (
                              <span className="text-xs text-slate-300 italic">Permanen</span>
                            )}
                            {m.is_archived && (
                              <span className="text-xs text-orange-400 italic">Diarsipkan</span>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Detail Pengguna" size="lg">
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-blue-100 flex items-center justify-center text-blue-700 text-2xl font-black shrink-0">
                {detailModal.nama_lengkap?.charAt(0)}
              </div>
              <div>
                <div className="font-bold text-slate-800 text-lg">{detailModal.nama_lengkap}</div>
                <div className="text-slate-400 text-sm">{detailModal.email}</div>
                <div className="flex gap-2 mt-1 flex-wrap">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[detailModal.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                    {detailModal.roles?.nama_role || '-'}
                  </span>
                  {(() => {
                    const sp = detailModal.anggota?.[0]?.status_pengguna || 'lajang'
                    return (
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusPenggunaBadge[sp] || 'bg-slate-100 text-slate-500'}`}>
                        {statusPenggunaLabel[sp] || sp}
                      </span>
                    )
                  })()}
                </div>
              </div>
            </div>

            {detailModal.is_archived && (
              <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-orange-800 text-sm">
                Akun ini diarsipkan. Alasan: <strong>{detailModal.alasan_arsip || '-'}</strong>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
              {[
                { label: 'No. Anggota', val: detailModal.anggota?.[0]?.nomor_anggota },
                { label: 'Email', val: detailModal.email },
                { label: 'No. HP', val: detailModal.no_hp },
                { label: 'Status Anggota', val: detailModal.anggota?.[0]?.status },
                { label: 'Status Akun', val: detailModal.is_archived ? 'Diarsipkan' : detailModal.is_active ? 'Aktif' : 'Non-aktif' },
                { label: 'Tempat Lahir', val: detailModal.anggota?.[0]?.tempat_lahir },
                { label: 'Tanggal Lahir', val: detailModal.anggota?.[0]?.tanggal_lahir ? new Date(detailModal.anggota[0].tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : null },
                { label: 'Jenis Kelamin', val: detailModal.anggota?.[0]?.jenis_kelamin },
                { label: 'Desa', val: detailModal.desa?.nama_desa },
                { label: 'Kelompok', val: detailModal.kelompok?.nama_kelompok },
                { label: 'Anak Ke-', val: (detailModal.anggota?.[0]?.anak_ke != null && detailModal.anggota?.[0]?.jumlah_saudara != null) ? `${detailModal.anggota[0].anak_ke} dari ${detailModal.anggota[0].jumlah_saudara} bersaudara` : detailModal.anggota?.[0]?.anak_ke != null ? `Anak ke-${detailModal.anggota[0].anak_ke}` : null },
                { label: 'Nama Ayah Kandung', val: detailModal.anggota?.[0]?.nama_ayah || detailModal.anggota?.[0]?.nama_orang_tua },
                { label: 'Nama Ibu Kandung', val: detailModal.anggota?.[0]?.nama_ibu },
                { label: 'Nama Wali', val: detailModal.anggota?.[0]?.nama_wali },
                { label: 'HP Orang Tua/Wali', val: detailModal.anggota?.[0]?.no_hp_orangtua_wali || detailModal.anggota?.[0]?.no_hp_orang_tua },
                { label: 'Bergabung Sejak', val: new Date(detailModal.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) },
              ].map(({ label, val }) => val ? (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm font-medium text-slate-700">{val}</p>
                </div>
              ) : null)}
            </div>

            {detailModal.anggota?.[0]?.alamat && (
              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs text-slate-400">Alamat</p>
                <p className="text-sm text-slate-700">{detailModal.anggota[0].alamat}</p>
              </div>
            )}

            <div className="flex gap-3 pt-2 border-t border-slate-100">
              {canActOn(detailModal) && (
                <button onClick={() => { setDetailModal(null); openEdit(detailModal) }}
                  className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition">
                  Edit
                </button>
              )}
              <button onClick={() => setDetailModal(null)}
                className="flex-1 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                Tutup
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? `Edit ${editTarget.nama_lengkap}` : 'Tambah Pengguna'} size="lg">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          {/* Tabs */}
          <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
            {(['info', 'akun'] as const).map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === tab ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab === 'info' ? 'Data Diri' : 'Akun & Akses'}
              </button>
            ))}
          </div>

          {activeTab === 'info' && (
            <div className="space-y-4">
              {editTarget?.anggota?.[0]?.nomor_anggota ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-400">No. Anggota</span>
                  <span className="font-mono text-sm font-semibold text-slate-600">{editTarget.anggota[0].nomor_anggota}</span>
                  <span className="text-xs text-slate-400 ml-auto">Auto-generate</span>
                </div>
              ) : !editTarget && (
                <div className="p-2 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-xs text-blue-500">No. Anggota akan dibuat otomatis (ANG-XXXX)</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap * (huruf kapital)</label>
                <input value={form.nama_lengkap}
                  onChange={e => setUpper('nama_lengkap', e.target.value)}
                  placeholder="NAMA LENGKAP"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tempat Lahir * (huruf kapital)</label>
                  <input value={form.tempat_lahir}
                    onChange={e => setUpper('tempat_lahir', e.target.value)}
                    placeholder="KOTA/KABUPATEN"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tanggal Lahir *</label>
                  <input type="date" value={form.tanggal_lahir} onChange={e => set('tanggal_lahir', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin *</label>
                  <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih --</option>
                    <option value="LAKI-LAKI">LAKI-LAKI</option>
                    <option value="PEREMPUAN">PEREMPUAN</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
                  <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)} placeholder="08xx-xxxx-xxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat * (huruf kapital)</label>
                <textarea value={form.alamat} onChange={e => setUpper('alamat', e.target.value)}
                  rows={2} placeholder="ALAMAT LENGKAP"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none uppercase" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Anak Ke-</label>
                  <input type="number" min="1" max="20" value={form.anak_ke} onChange={e => set('anak_ke', e.target.value)}
                    placeholder="1"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dari ... Bersaudara</label>
                  <input type="number" min="1" max="20" value={form.jumlah_saudara} onChange={e => set('jumlah_saudara', e.target.value)}
                    placeholder="3"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 mb-3">Data Orang Tua / Wali</p>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ayah Kandung * (huruf kapital)</label>
                    <input value={form.nama_ayah}
                      onChange={e => setUpper('nama_ayah', e.target.value)}
                      placeholder="NAMA AYAH"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ibu Kandung * (huruf kapital)</label>
                    <input value={form.nama_ibu}
                      onChange={e => setUpper('nama_ibu', e.target.value)}
                      placeholder="NAMA IBU"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Wali (jika ada, huruf kapital)</label>
                    <input value={form.nama_wali}
                      onChange={e => setUpper('nama_wali', e.target.value)}
                      placeholder="NAMA WALI (opsional)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">No. HP Orang Tua/Wali *</label>
                    <input value={form.no_hp_orangtua_wali} onChange={e => set('no_hp_orangtua_wali', e.target.value)}
                      placeholder="08xx-xxxx-xxxx"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>

              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status Akun</label>
                    <select value={form.status_anggota} onChange={e => set('status_anggota', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="aktif">Aktif</option>
                      <option value="non-aktif">Non-aktif</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Status Pengguna</label>
                    {!editTarget ? (
                      <div className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-100 text-sm text-slate-500">
                        Lajang (auto)
                      </div>
                    ) : (
                      <select value={form.status_pengguna}
                        onChange={e => setForm(f => ({
                          ...f,
                          status_pengguna: e.target.value,
                          pindah_jenis: 'bekasi_timur',
                          pindah_desa_id: '',
                          pindah_kelompok_id: '',
                        }))}
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                        <option value="lajang">Lajang</option>
                        <option value="menikah">Menikah</option>
                        <option value="pindah_sambung">Pindah Sambung</option>
                        <option value="meninggal_dunia">Meninggal Dunia</option>
                      </select>
                    )}
                  </div>
                </div>

                {editTarget && form.status_pengguna === 'pindah_sambung' && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl space-y-3">
                    <p className="text-xs font-semibold text-amber-800">Tujuan Pindah Sambung</p>
                    <div className="flex gap-6">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="pindah_jenis" value="bekasi_timur"
                          checked={form.pindah_jenis === 'bekasi_timur'}
                          onChange={() => setForm(f => ({ ...f, pindah_jenis: 'bekasi_timur', pindah_desa_id: '', pindah_kelompok_id: '' }))}
                          className="accent-amber-600" />
                        <span className="text-sm text-amber-800 font-medium">Masih di Bekasi Timur</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="pindah_jenis" value="daerah_lain"
                          checked={form.pindah_jenis === 'daerah_lain'}
                          onChange={() => setForm(f => ({ ...f, pindah_jenis: 'daerah_lain', pindah_desa_id: '', pindah_kelompok_id: '' }))}
                          className="accent-amber-600" />
                        <span className="text-sm text-amber-800 font-medium">Ke Daerah Lain</span>
                      </label>
                    </div>

                    {form.pindah_jenis === 'bekasi_timur' && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium text-amber-800 mb-1">Desa Tujuan *</label>
                          <select value={form.pindah_desa_id}
                            onChange={e => setForm(f => ({ ...f, pindah_desa_id: e.target.value, pindah_kelompok_id: '' }))}
                            className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                            <option value="">-- Pilih Desa --</option>
                            {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-amber-800 mb-1">Kelompok Tujuan *</label>
                          <select value={form.pindah_kelompok_id}
                            onChange={e => set('pindah_kelompok_id', e.target.value)}
                            className="w-full px-3 py-2 rounded-xl border border-amber-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-400">
                            <option value="">-- Pilih Kelompok --</option>
                            {kelompokList.filter(k => !form.pindah_desa_id || k.desa_id === form.pindah_desa_id).map(k => (
                              <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}

                    {form.pindah_jenis === 'daerah_lain' && (
                      <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs leading-relaxed">
                        Akun akan diarsipkan. Untuk mengaktifkan kembali, pengguna harus mengajukan permohonan kepada Ketua Muda-Mudi Daerah terlebih dahulu.
                      </div>
                    )}
                  </div>
                )}

                {editTarget && (form.status_pengguna === 'menikah' || form.status_pengguna === 'meninggal_dunia') && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs leading-relaxed">
                    Menyimpan dengan status ini akan mengarsipkan dan menonaktifkan akun pengguna. Diperlukan 2x konfirmasi sebelum perubahan diterapkan.
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'akun' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email {!editTarget && '*'}</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    disabled={!!editTarget} placeholder="email@domain.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Password {editTarget ? '(kosongkan jika tidak diubah)' : '*'}
                  </label>
                  <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                    placeholder={editTarget ? 'Password baru (opsional)' : 'Min. 6 karakter'}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Role / Hak Akses</label>
                <select value={form.role_id} onChange={e => set('role_id', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">-- Pilih Role --</option>
                  {roleList.filter(r => r.tingkatan !== 'super_admin').map(r => <option key={r.id} value={r.id}>{r.nama_role}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
                  <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Tidak ada --</option>
                    {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
                  <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Tidak ada --</option>
                    {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                      <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                    ))}
                  </select>
                </div>
              </div>

              {editTarget && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Akun aktif (bisa login)</span>
                </label>
              )}
            </div>
          )}

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirmation Modal */}
      {confirmOpen && confirmType && (
        <Modal open={confirmOpen} onClose={() => setConfirmOpen(false)} title={confirmMessages[confirmType].title} size="sm">
          <div className="space-y-4">
            <p className="text-slate-700 text-sm leading-relaxed">
              {confirmStep === 1
                ? confirmMessages[confirmType].step1
                : confirmMessages[confirmType].step2(editTarget?.nama_lengkap || '')}
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmOpen(false)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                Batal
              </button>
              {confirmStep === 1 ? (
                <button onClick={() => setConfirmStep(2)}
                  className="flex-1 py-2.5 bg-amber-500 text-white rounded-xl text-sm font-medium hover:bg-amber-600 transition">
                  Lanjut
                </button>
              ) : (
                <button onClick={doActualSave}
                  className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 transition">
                  Ya, Konfirmasi
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
