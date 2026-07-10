'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { authFetch } from '@/lib/auth'
import { canManageMembers as checkCanManageMembers, getAllowedTargetTingkatan } from '@/lib/roles'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { formatAge } from '@/lib/date'
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
  // PENTING: generus.user_id punya UNIQUE constraint (relasi 1-ke-1 dgn users), jadi
  // PostgREST mengembalikan embed ini sbg OBJEK TUNGGAL, bukan array -- beda dari relasi
  // 1-ke-banyak biasa. Sebelumnya interface ini salah ditulis sbg array (`{...}[] | null`)
  // dan diakses dgn `.generus?.[0]` di 8 tempat, yang SELALU mengembalikan undefined
  // (mengakses index [0] pada objek, bukan array) -- inilah sebab No. Generus & field
  // Generus lain selalu tampil kosong di menu Pengguna meski datanya lengkap di database.
  generus: {
    id: string
    nomor_generus: string
    nama_panggilan: string | null
    tanggal_lahir: string | null
    tempat_lahir: string | null
    jenis_kelamin: string | null
    alamat: string | null
    tinggi_badan: number | null
    berat_badan: number | null
    kelas_ngaji: string | null
    nama_ayah: string | null
    nama_ibu: string | null
    nama_wali: string | null
    no_hp_orangtua_wali: string | null
    status: string
    status_pengguna: string | null
    pindah_desa_id: string | null
    pindah_kelompok_id: string | null
    pindah_ke_daerah_lain: boolean | null
    anak_ke: number | null
    jumlah_saudara: number | null
  } | null
}

interface RoleOpt { id: string; nama_role: string; tingkatan: string }
interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

// Field biodata (alamat, tinggi/berat badan, kelas ngaji, nama ortu/wali, anak ke-,
// jumlah saudara) SENGAJA TIDAK ADA di sini lagi -- modal ini murni akun, biodata
// dikelola di menu "Data Generus" terpisah. tempat_lahir/tanggal_lahir/jenis_kelamin
// tetap ada karena masih wajib diisi saat membuat pengguna BARU (dipakai server men-
// generate login_username & password awal), lihat generusFieldsCreateOnly di doActualSave.
const emptyForm = {
  email: '',
  password: '',
  nama_lengkap: '',
  nama_panggilan: '',
  no_hp: '',
  role_id: '',
  desa_id: '',
  kelompok_id: '',
  is_active: true,
  tempat_lahir: '',
  tanggal_lahir: '',
  jenis_kelamin: '',
  status_anggota: 'aktif',
  status_pengguna: 'lajang',
  pindah_jenis: 'bekasi_timur',
  pindah_desa_id: '',
  pindah_kelompok_id: '',
}

// kelasNgajiLabel dipindah ke app/(dashboard)/data-generus/page.tsx -- satu-satunya
// tempat field Kelas Ngaji masih ditampilkan/diedit sejak menu ini jadi murni akun.
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
  // Confirmation dialog state
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1)
  const [confirmType, setConfirmType] = useState<ConfirmType | null>(null)
  // Ditampilkan sekali setelah berhasil membuat pengguna baru -- berisi Nama Pengguna
  // (login_username) & password default (tanggal lahir) hasil generate server, supaya
  // admin bisa langsung mencatat/menyampaikan ke pengguna baru. Tidak disimpan di
  // state lain manapun setelah modal ini ditutup (sesuai sifat password sekali-lihat).
  const [newCredentials, setNewCredentials] = useState<{ nama: string; username: string; password: string; biodataWarning?: string } | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('users')
      .select(`
        id, email, nama_lengkap, no_hp, is_active, is_archived, alasan_arsip, created_at, desa_id, kelompok_id, role_id,
        roles:role_id(id, nama_role, tingkatan),
        desa:desa_id(id, nama_desa),
        kelompok:kelompok_id(id, nama_kelompok),
        generus(id, nomor_generus, nama_panggilan, tanggal_lahir, tempat_lahir, jenis_kelamin, alamat, tinggi_badan, berat_badan, kelas_ngaji, nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali, status, status_pengguna, pindah_desa_id, pindah_kelompok_id, pindah_ke_daerah_lain, anak_ke, jumlah_saudara)
      `)
      .order('nama_lengkap')

    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    // CATATAN: filter super_admin SENGAJA TIDAK dilakukan di query PostgREST
    // (`.not('roles.tingkatan', 'eq', 'super_admin')`) -- filter negasi pada embedded
    // resource/relasi nested seperti ini terbukti (ditemukan saat uji production)
    // mengecualikan SEMUA baris, bukan cuma yang match, karena PostgREST menerapkannya
    // sebagai INNER JOIN + NOT filter yang gagal untuk baris dengan relasi null/tidak match
    // secara konsisten. Filter Super Admin dilakukan MURNI di client (di bawah), yang mana
    // sudah cukup karena hasil query tetap dibatasi scope (kelompok_id/desa_id) di atas.
    const { data: rows, error: err } = await query
    if (err) console.error('Pengguna load error:', err)
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
    setError('')
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (m: Member) => {
    setEditTarget(m)
    setError('')
    const a = m.generus
    setForm({
      email: m.email,
      password: '',
      nama_lengkap: m.nama_lengkap,
      nama_panggilan: a?.nama_panggilan || '',
      no_hp: m.no_hp || '',
      role_id: m.roles?.id || '',
      desa_id: m.desa?.id || '',
      kelompok_id: m.kelompok?.id || '',
      is_active: m.is_active,
      tempat_lahir: a?.tempat_lahir || '',
      tanggal_lahir: a?.tanggal_lahir || '',
      jenis_kelamin: a?.jenis_kelamin || '',
      status_anggota: a?.status || 'aktif',
      status_pengguna: a?.status_pengguna || 'lajang',
      pindah_jenis: a?.pindah_ke_daerah_lain ? 'daerah_lain' : 'bekasi_timur',
      pindah_desa_id: a?.pindah_desa_id || '',
      pindah_kelompok_id: a?.pindah_kelompok_id || '',
    })
    setModalOpen(true)
  }

  const doActualSave = async () => {
    setSaving(true)
    try {
      // PPG dikecualikan dari arsip otomatis saat status_pengguna = 'menikah' -- role PPG
      // (Penggerak Pembina Generus) mayoritas sudah menikah, itu bukan indikasi ybs berhenti
      // aktif/butuh diarsipkan seperti pada Generus biasa. Meninggal Dunia & Pindah Sambung ke
      // Daerah Lain TETAP mengarsipkan meski PPG, karena dua kondisi itu memang berarti ybs
      // sudah tidak bisa/tidak lagi menjalankan tugasnya di Bekasi Timur.
      const isTargetPPG = editTarget?.roles?.tingkatan === 'ppg'
      const needsArchive = !!editTarget && (
        (form.status_pengguna === 'menikah' && !isTargetPPG) ||
        form.status_pengguna === 'meninggal_dunia' ||
        (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain')
      )

      // PENTING -- pemisahan ini mencegah bug sinkronisasi: modal ini murni akun, field
      // biodata (alamat, ortu, tinggi/berat, kelas ngaji, dll) TIDAK PUNYA input UI di sini
      // lagi (sudah dipindah ke menu "Data Generus" terpisah). Sebelumnya field-field itu
      // masih ikut dikirim di setiap PATCH (dibawa balik dari state form hasil pre-fill
      // openEdit()) -- meskipun tidak sampai menimpa dengan string kosong (karena di-pre-fill
      // dulu), ini tetap berisiko race condition: kalau Sekretaris sedang edit biodata di
      // Data Generus BERSAMAAN Ketua edit akun di Pengguna, siapa yang menyimpan belakangan
      // akan menimpa balik dengan data biodata versi STALE yang dibawa form Pengguna diam-diam.
      // Sekarang: field biodata HANYA dikirim saat CREATE user baru (wajib utk generate
      // login_username & password awal dari tanggal_lahir), TIDAK PERNAH dikirim lagi saat
      // EDIT/PATCH akun yang sudah ada -- mengedit biodata sesudahnya harus lewat Data Generus.
      const generusFieldsCreateOnly = !editTarget ? {
        nama_panggilan: form.nama_panggilan || null,
        tempat_lahir: form.tempat_lahir || null,
        tanggal_lahir: form.tanggal_lahir,
        jenis_kelamin: form.jenis_kelamin,
      } : {}

      // Field yang MEMANG murni urusan akun/status keanggotaan (bukan biodata pribadi) --
      // status_anggota (Status Akun Generus: aktif/non-aktif), status_pengguna & pindah_sambung
      // sengaja tetap di sini (lihat keputusan: menu Pengguna tetap pegang status yang
      // langsung berdampak ke akses/arsip akun) -- SEMUA field ini masih punya input UI aktif
      // di modal ini (lihat dropdown "Status Akun" & "Status Pengguna" di bawah), jadi wajib
      // tetap ikut dikirim, beda dari field biodata murni (alamat, ortu, dll) yang inputnya
      // sudah tidak ada sama sekali di modal ini.
      const akunStatusFields = editTarget ? {
        status_anggota: form.status_anggota,
        status_pengguna: form.status_pengguna,
        pindah_desa_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_desa_id || null : null,
        pindah_kelompok_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_kelompok_id || null : null,
        pindah_ke_daerah_lain: form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain',
      } : {}

      const generusFields = { ...generusFieldsCreateOnly, ...akunStatusFields }

      let userId = editTarget?.id

      if (!editTarget) {
        // password TIDAK dikirim -- server men-generate otomatis dari tanggal_lahir
        // (lihat app/api/users/route.ts, passwordFromTanggalLahir). login_username juga
        // di-generate server-side dari nama_panggilan (fallback nama_lengkap).
        const res = await authFetch('/api/users', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: form.email,
            nama_lengkap: form.nama_lengkap,
            no_hp: form.no_hp,
            role_id: form.role_id,
            desa_id: form.desa_id,
            kelompok_id: form.kelompok_id,
            ...generusFields,
          }),
        })
        const json = await res.json()
        // Status 207 = akun BERHASIL dibuat tapi biodata Generus gagal tersimpan (lihat
        // app/api/users/route.ts POST) -- beda dari kegagalan total (mis. email sudah
        // dipakai), di sini kredensial akun TETAP harus ditampilkan karena akunnya nyata
        // dan bisa login. Peringatannya disimpan sbg biodataWarning (bukan setError yg
        // hanya tampil DI DALAM modal ini, yang sudah tertutup begitu newCredentials diisi)
        // supaya benar-benar terlihat admin di modal kredensial berikutnya.
        if (json.error && res.status !== 207) { setError(json.error); return }
        userId = json.userId
        // Tampilkan kredensial default sekali ke admin -- tidak ada cara lain untuk
        // melihat password ini lagi setelah modal ditutup (sesuai desain, bukan disimpan).
        setNewCredentials({
          nama: form.nama_lengkap,
          username: json.loginUsername,
          password: json.defaultPassword,
          biodataWarning: res.status === 207 ? json.error : undefined,
        })
      } else {
        const existingGenerus = editTarget.generus

        // Pindah sambung Bekasi Timur: update desa/kelompok ke tujuan baru
        const targetDesaId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_desa_id)
          ? form.pindah_desa_id
          : form.desa_id
        const targetKelompokId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_kelompok_id)
          ? form.pindah_kelompok_id
          : form.kelompok_id

        // AKUN (email/no_hp/role/scope/status aktif/password) -- lewat /api/users.
        const body: Record<string, unknown> = {
          id: editTarget.id,
          nama_lengkap: form.nama_lengkap,
          no_hp: form.no_hp,
          role_id: form.role_id,
          desa_id: targetDesaId,
          kelompok_id: targetKelompokId,
          is_active: needsArchive ? false : form.is_active,
          password: form.password || undefined,
        }

        if (needsArchive) {
          const alasan =
            form.status_pengguna === 'menikah' ? 'Menikah' :
            form.status_pengguna === 'meninggal_dunia' ? 'Meninggal Dunia' :
            'Pindah Sambung ke Daerah Lain'
          body.archive = true
          body.alasan_arsip = alasan
        }

        const res = await authFetch('/api/users', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        const json = await res.json()
        if (json.error) { setError(json.error); return }

        // BIODATA & status keanggotaan (status_anggota/status_pengguna/pindah sambung) --
        // lewat /api/generus. Dipisah dari body akun di atas krn sekarang dua endpoint
        // berbeda -- lihat app/api/generus/route.ts.
        if (Object.keys(generusFields).length > 0) {
          const resGenerus = await authFetch('/api/generus', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: editTarget.id,
              generus_id: existingGenerus?.id,
              ...generusFields,
            }),
          })
          const jsonGenerus = await resGenerus.json()
          if (jsonGenerus.error) { setError(jsonGenerus.error); return }
        }
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
    // Modal ini sekarang murni akun -- biodata lengkap (alamat, ortu, tinggi/berat, kelas
    // ngaji, dll) dikelola di menu "Data Generus" terpisah. Untuk pengguna BARU, nama
    // lengkap/panggilan/tanggal lahir/jenis kelamin tetap wajib di sini karena dipakai
    // server men-generate nama pengguna (login_username) & password awal akun.
    if (!form.role_id) { setError('Role wajib dipilih'); return }
    if (!form.email) { setError('Email wajib diisi (dipakai untuk notifikasi sistem)'); return }
    if (!form.desa_id) { setError('Alamat sambung: desa wajib dipilih'); return }
    if (!form.kelompok_id) { setError('Alamat sambung: kelompok wajib dipilih'); return }
    if (!editTarget) {
      if (!form.nama_lengkap) { setError('Nama lengkap wajib diisi'); return }
      if (!form.nama_panggilan) { setError('Nama panggilan wajib diisi'); return }
      if (!form.tanggal_lahir) { setError('Tanggal lahir wajib diisi (dipakai sebagai password awal)'); return }
      if (!form.jenis_kelamin) { setError('Jenis kelamin wajib diisi'); return }
    }

    // Validasi pindah sambung Bekasi Timur
    if (editTarget && form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') {
      if (!form.pindah_desa_id) { setError('Pilih desa tujuan pindah sambung'); return }
      if (!form.pindah_kelompok_id) { setError('Pilih kelompok tujuan pindah sambung'); return }
    }

    // Cek apakah perlu arsip → tampilkan konfirmasi. PPG dikecualikan dari arsip otomatis
    // saat status_pengguna = 'menikah' -- lihat catatan lengkap di doActualSave.
    const isTargetPPGForSave = editTarget?.roles?.tingkatan === 'ppg'
    const needsArchive = !!editTarget && (
      (form.status_pengguna === 'menikah' && !isTargetPPGForSave) ||
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
    await authFetch('/api/users', {
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
        m.generus?.nomor_generus?.toLowerCase().includes(q) ||
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

  // Hanya Ketua/Wakil Ketua/Sekretaris (semua scope) dan Super Admin yang bisa mengelola
  // Generus -- lihat canManageMembers di lib/roles.ts untuk definisi lengkapnya (sumber
  // kebenaran tunggal, jangan duplikasi logika "includes ketua/sekretaris" di sini).
  // Role pengurus lain (Bendahara, Kemandirian, Keputrian, dll) dan Generus biasa hanya
  // bisa melihat daftar.
  const canManageMembers = checkCanManageMembers(user)

  // Cek apakah user bisa edit/tambah member tertentu (termasuk mengubah status
  // aktif/nonaktif saat status berubah jadi menikah/meninggal dunia/pindah sambung) --
  // gabungan hak akses role (canManageMembers) DAN scope (desa/kelompok yang sama).
  const canActOn = (m: Member): boolean => {
    if (!canManageMembers) return false
    if (isSuperAdmin || user?.role?.tingkatan === 'daerah') return true
    if (user?.role?.tingkatan === 'desa') return m.desa_id === user?.desa_id
    if (user?.role?.tingkatan === 'kelompok') return m.kelompok_id === user?.kelompok_id
    return false
  }

  // Tombol Tambah Pengguna: hanya Ketua/Wakil Ketua/Sekretaris/Super Admin
  const canManage = canManageMembers

  // Fitur export PDF/Excel dipindah ke menu "Data Generus" -- di sana biodata
  // lengkap (TTL, kelas ngaji, dll) tersedia dan bisa dijamin terisi benar, sedangkan
  // menu ini sekarang murni akun.

  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu "Pengguna" utk jenjang
  // role user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok di sini.
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'generus')
  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Pengguna saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Pengguna</h2>
          <p className="text-slate-400 text-sm">{data.length} pengguna terdaftar</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Pengguna
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Cari nama, email, nomor generus, desa..."
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
                  <th className="px-4 py-3 font-medium">No. Generus</th>
                  <th className="px-4 py-3 font-medium">Role</th>
                  <th className="px-4 py-3 font-medium">Desa / Kelompok</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(m => {
                  const a = m.generus
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
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{a?.nomor_generus || '—'}</td>
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
                    const sp = detailModal.generus?.status_pengguna || 'lajang'
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
                { label: 'No. Generus', val: detailModal.generus?.nomor_generus },
                { label: 'Bergabung Sejak', val: new Date(detailModal.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) },
                { label: 'Status Akun', val: detailModal.is_archived ? 'Diarsipkan' : detailModal.is_active ? 'Aktif' : 'Non-aktif' },
                { label: 'Status Generus', val: detailModal.generus?.status?.toUpperCase() },
                { label: 'Jenis Kelamin', val: detailModal.generus?.jenis_kelamin?.toUpperCase() },
                // Usia dihitung otomatis dari generus.tanggal_lahir, bukan kolom database --
                // lihat lib/date.ts. formatAge mengembalikan '-' kalau tanggal_lahir kosong,
                // jadi baris ini otomatis tersembunyi (val falsy) utk data lama yg belum lengkap.
                { label: 'Usia', val: detailModal.generus?.tanggal_lahir ? formatAge(detailModal.generus.tanggal_lahir) : null },
              ].map(({ label, val }) => val ? (
                <div key={label}>
                  <p className="text-xs text-slate-400">{label}</p>
                  <p className="text-sm font-medium text-slate-700">{val}</p>
                </div>
              ) : null)}
            </div>

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

          {/* Modal ini murni untuk data AKUN (login & hak akses). Biodata lengkap Generus
              (tempat/tanggal lahir selain saat pembuatan awal, alamat, data orang tua, tinggi/
              berat badan, kelas ngaji, dll) dikelola terpisah di menu "Data Generus" -- supaya
              yang mengurus akun tidak otomatis melihat data pribadi yang sensitif kalau tidak
              berwenang, sekaligus menegaskan pemisahan konsep akun vs biodata Generus. */}
          <div className="space-y-4">
            {!editTarget && (
              <>
                <div className="p-2 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-xs text-blue-500">
                    Nama & tanggal lahir dipakai sistem untuk membuat Nama Pengguna dan password awal akun. Biodata lengkap (alamat, data orang tua, dll) dilengkapi nanti di menu &quot;Data Generus&quot;.
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Lengkap * (huruf kapital)</label>
                    <input value={form.nama_lengkap}
                      onChange={e => setUpper('nama_lengkap', e.target.value)}
                      placeholder="NAMA LENGKAP"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Panggilan * (huruf kapital)</label>
                    <input value={form.nama_panggilan}
                      onChange={e => setUpper('nama_panggilan', e.target.value)}
                      placeholder="NAMA PANGGILAN"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1">
                      Tanggal Lahir *
                      {/* Usia dihitung otomatis dari tanggal_lahir yang diinput -- TIDAK
                          disimpan sbg kolom database, jadi selalu akurat & bertambah sendiri
                          tiap tahun. Lihat lib/date.ts (calculateAge/formatAge). */}
                      {form.tanggal_lahir && (
                        <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-semibold normal-case">
                          {formatAge(form.tanggal_lahir)}
                        </span>
                      )}
                    </label>
                    <input type="date" value={form.tanggal_lahir} onChange={e => set('tanggal_lahir', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <p className="text-[11px] text-blue-500 mt-1">Dipakai juga sebagai password awal akun (format DDMMYYYY)</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin *</label>
                    <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                      <option value="">-- Pilih --</option>
                      {/* value HARUS lowercase -- kolom generus.jenis_kelamin dibatasi CHECK
                          constraint anggota_jenis_kelamin_check (hanya 'laki-laki'/'perempuan').
                          Value uppercase sebelumnya membuat insert generus GAGAL DIAM-DIAM saat
                          membuat pengguna baru dengan jenis kelamin terisi. */}
                      <option value="laki-laki">LAKI-LAKI</option>
                      <option value="perempuan">PEREMPUAN</option>
                    </select>
                  </div>
                </div>
              </>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Role / Hak Akses *</label>
              <select value={form.role_id} onChange={e => set('role_id', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Pilih Role --</option>
                {/* Hanya tampilkan role yang boleh DITETAPKAN oleh user ini, sesuai hierarki jenjang
                    (lihat getAllowedTargetTingkatan di lib/roles.ts) -- mis. Sekretaris Kelompok
                    hanya melihat role Generus, tidak melihat "Ketua Daerah" atau PPG sama sekali.
                    Server (app/api/users/route.ts) tetap menegakkan ulang aturan yang sama persis;
                    filter di sini murni supaya dropdown tidak menampilkan pilihan yang toh ditolak. */}
                {roleList
                  .filter(r => getAllowedTargetTingkatan(user).includes(r.tingkatan))
                  .map(r => <option key={r.id} value={r.id}>{r.nama_role}</option>)}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Email * (untuk notifikasi sistem)</label>
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                placeholder="email@domain.com"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <p className="text-[11px] text-slate-400 mt-1">
                Login sehari-hari memakai Nama Pengguna, bukan email ini — email hanya dipakai sistem untuk mengirim notifikasi (pengumuman, kegiatan, dsb).
              </p>
            </div>

            <div>
              <p className="text-xs font-semibold text-slate-500 mb-2">Alamat Sambung</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Desa *</label>
                  <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih Desa --</option>
                    {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok *</label>
                  <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih Kelompok --</option>
                    {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                      <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {editTarget && (
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Ganti Password (opsional)</label>
                  <input type="password" value={form.password} onChange={e => set('password', e.target.value)}
                    placeholder="Kosongkan jika tidak diubah"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Akun aktif (bisa login)</span>
                </label>
                {editTarget.created_at && (
                  <p className="text-xs text-slate-400">
                    Bergabung sejak {new Date(editTarget.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                )}
              </div>
            )}

            {editTarget && (
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
                  </div>
                </div>

                {form.status_pengguna === 'pindah_sambung' && (
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

                {form.status_pengguna === 'menikah' && editTarget?.roles?.tingkatan === 'ppg' && (
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-blue-700 text-xs leading-relaxed">
                    Akun PPG tidak diarsipkan otomatis saat berstatus "Menikah" -- status hanya dicatat sebagai info biodata, akun tetap aktif seperti biasa.
                  </div>
                )}

                {((form.status_pengguna === 'menikah' && editTarget?.roles?.tingkatan !== 'ppg') || form.status_pengguna === 'meninggal_dunia') && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs leading-relaxed">
                    Menyimpan dengan status ini akan mengarsipkan dan menonaktifkan akun pengguna. Diperlukan 2x konfirmasi sebelum perubahan diterapkan.
                  </div>
                )}
              </div>
            )}
          </div>

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

      {/* Modal kredensial akun baru -- ditampilkan SEKALI setelah berhasil membuat pengguna,
          tidak disimpan di manapun setelah ditutup. Admin wajib mencatat/menyampaikan info
          ini secara manual ke pengguna baru (mis. lewat WhatsApp/lisan). */}
      {newCredentials && (
        <Modal open={!!newCredentials} onClose={() => setNewCredentials(null)} title="Pengguna Berhasil Dibuat" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Akun <span className="font-semibold">{newCredentials.nama}</span> berhasil dibuat. Catat dan sampaikan kredensial berikut ke pengguna:
            </p>
            {newCredentials.biodataWarning && (
              <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
                ⚠️ {newCredentials.biodataWarning}
              </div>
            )}
            <div className="space-y-2">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-400 mb-0.5">Nama Pengguna (untuk login)</p>
                <p className="font-mono font-semibold text-slate-800">{newCredentials.username}</p>
              </div>
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                <p className="text-xs text-slate-400 mb-0.5">Password Awal</p>
                <p className="font-mono font-semibold text-slate-800">{newCredentials.password}</p>
              </div>
            </div>
            <div className="p-3 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-700">
              Password ini hanya ditampilkan sekali dan tidak tersimpan di sistem dalam bentuk terbaca. Untuk mengganti password, pengguna dapat mengajukan permintaan lewat halaman &quot;Lupa Password&quot;.
            </div>
            <button onClick={() => setNewCredentials(null)}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition">
              Sudah Dicatat
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
