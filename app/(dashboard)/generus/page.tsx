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
import PasswordInput from '@/components/PasswordInput'
import { exportToPDF, exportToExcel } from '@/lib/export'

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
  // PostgREST mengembalikan embed ini sbg OBJEK TUNGGAL, bukan array.
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

// Menu "Data Generus" -- database akun & biodata Generus se-Bekasi Timur, satu halaman dgn
// 2 tab di modal Edit -- "Akun" & "Biodata" (dulu dua menu terpisah: "Pengguna" utk akun,
// "Data Generus" utk biodata; digabung & nama menunya dipakai utk keseluruhan halaman karena
// isinya memang database Generus, bukan sekadar akun login). Alasan gabung: audiens kedua sisi
// ini sudah identik persis
// (roles + hideForGenerus sama, lihat app/(dashboard)/layout.tsx), dan query di bawah sudah
// menarik data biodata lengkap dalam satu request yang sama sejak awal, jadi menggabungkan
// UI-nya menyederhanakan navigasi tanpa mengubah model data. DUA endpoint tulis TETAP terpisah
// (/api/users utk akun, /api/generus utk biodata) -- pemisahan itu sengaja dipertahankan utk
// menghindari race condition penimpaan data basi (lihat catatan di doActualSave). Toggle fitur
// per-jenjang (Pengaturan Fitur) juga TETAP 2 key terpisah ('generus' & 'data-generus'), sekarang
// menggerbangi tab Biodata + tombol export, bukan lagi route terpisah -- lihat useBiodataAccess.
//
// PPG SENGAJA TIDAK dapat tab Biodata di sini -- PPG bukan Generus (tidak ada kelas ngaji/data
// ortu/anak asuh), biodatanya tetap dikelola terpisah lewat menu "Data Pembina". Field
// administratif (Status Akun/Status Pengguna) pada akun PPG juga dikunci utk Super Admin saja
// (lihat isPPGAdminLocked) -- PPG berada DI ATAS jenjang Daerah (pengawas, bukan bawahan), jadi
// Ketua/Sekretaris Daerah tidak boleh menonaktifkan/mengarsipkan/menurunkan role akun PPG,
// konsisten dgn proteksi yang sama persis sudah ditegakkan di app/api/users/route.ts &
// app/api/generus/route.ts (server adalah enforcement sesungguhnya, ini cuma cerminan UI).
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
  alamat: '',
  tinggi_badan: '',
  berat_badan: '',
  kelas_ngaji: '',
  nama_ayah: '',
  nama_ibu: '',
  nama_wali: '',
  no_hp_orangtua_wali: '',
  anak_ke: '',
  jumlah_saudara: '',
  status_anggota: 'aktif',
  status_pengguna: 'lajang',
  pindah_jenis: 'bekasi_timur',
  pindah_desa_id: '',
  pindah_kelompok_id: '',
}

const kelasNgajiLabel: Record<string, string> = {
  pra_remaja: 'Pra Remaja (SMP)',
  remaja_muda: 'Remaja Muda (SMA)',
  remaja_dewasa: 'Remaja Dewasa (Lulus SMA - Usia Mandiri)',
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
  ppg: 'bg-indigo-100 text-indigo-700',
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

const exportColumns = [
  { header: 'No. Generus', key: 'no', width: 14 },
  { header: 'Nama Lengkap', key: 'nama', width: 26 },
  { header: 'Nama Panggilan', key: 'panggilan', width: 18 },
  { header: 'Jenis Kelamin', key: 'jk', width: 14 },
  { header: 'Tempat, Tgl Lahir', key: 'ttl', width: 24 },
  { header: 'Kelas Ngaji', key: 'kelas_ngaji', width: 24 },
  { header: 'Alamat', key: 'alamat', width: 30 },
  { header: 'Nama Ayah', key: 'nama_ayah', width: 22 },
  { header: 'Nama Ibu', key: 'nama_ibu', width: 22 },
  { header: 'No. HP Ortu/Wali', key: 'hp_ortu', width: 18 },
  { header: 'Desa', key: 'desa', width: 18 },
  { header: 'Kelompok', key: 'kelompok', width: 18 },
]

export default function DataGenerusPage() {
  const { user } = useUser()
  const [data, setData] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | 'aktif' | 'nonaktif' | 'diarsipkan'>('')
  const [sortBy, setSortBy] = useState<'nama_asc' | 'nama_desc' | 'terbaru'>('nama_asc')
  const [modalOpen, setModalOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<'akun' | 'biodata'>('akun')
  const [detailModal, setDetailModal] = useState<Member | null>(null)
  const [editTarget, setEditTarget] = useState<Member | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [roleList, setRoleList] = useState<RoleOpt[]>([])
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])
  const [exporting, setExporting] = useState(false)
  // Confirmation dialog state (arsip 2-langkah)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmStep, setConfirmStep] = useState<1 | 2>(1)
  const [confirmType, setConfirmType] = useState<ConfirmType | null>(null)
  // Konfirmasi Pulihkan akun -- Modal custom menggantikan window.confirm() bawaan browser
  // supaya konsisten secara visual dgn pola konfirmasi lain di halaman ini.
  const [restoreTarget, setRestoreTarget] = useState<Member | null>(null)
  // Notice satu-tombol umum -- menggantikan window.alert() bawaan browser (dipakai utk pesan
  // blokir Super Admin/PPG & error non-fatal dari aksi cepat di tabel).
  const [notice, setNotice] = useState<string | null>(null)
  // Ditampilkan sekali setelah berhasil membuat pengguna baru
  const [newCredentials, setNewCredentials] = useState<{ nama: string; username: string; password: string; biodataWarning?: string } | null>(null)
  // Diisi kalau /api/generus PATCH mengembalikan newLoginUsername
  const [usernameChangedNotice, setUsernameChangedNotice] = useState<{ nama: string; username: string } | null>(null)

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

    // CATATAN: filter super_admin SENGAJA TIDAK dilakukan di query PostgREST (filter negasi
    // pada embedded resource/relasi nested terbukti mengecualikan SEMUA baris di production).
    // Dilakukan murni di client, yang cukup krn hasil query tetap dibatasi scope di atas.
    const { data: rows, error: err } = await query
    if (err) console.error('Pengguna load error:', err)
    const filteredRows = (rows as unknown as Member[])?.filter(
      m => m.roles?.tingkatan !== 'super_admin'
    ) || []
    setData(filteredRows)
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    setActiveTab('akun')
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (m: Member) => {
    setEditTarget(m)
    setError('')
    setActiveTab('akun')
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
      alamat: a?.alamat || '',
      tinggi_badan: a?.tinggi_badan?.toString() || '',
      berat_badan: a?.berat_badan?.toString() || '',
      kelas_ngaji: a?.kelas_ngaji || '',
      nama_ayah: a?.nama_ayah || '',
      nama_ibu: a?.nama_ibu || '',
      nama_wali: a?.nama_wali || '',
      no_hp_orangtua_wali: a?.no_hp_orangtua_wali || '',
      anak_ke: a?.anak_ke?.toString() || '',
      jumlah_saudara: a?.jumlah_saudara?.toString() || '',
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
      const isTargetPPG = editTarget?.roles?.tingkatan === 'ppg'
      // Field administratif (Status Akun/Status Pengguna/pindah sambung) pada akun PPG hanya
      // boleh disentuh Super Admin -- cerminan client dari proteksi server di
      // app/api/users/route.ts & app/api/generus/route.ts (lihat catatan isTargetPPG di sana).
      // UI-nya sendiri sudah menyembunyikan kontrol ini utk kasus terkunci (lihat render di
      // bawah), guard di sini murni jaring pengaman kedua.
      const isPPGAdminLocked = isTargetPPG && !isSuperAdmin

      // PPG dikecualikan dari arsip otomatis saat status_pengguna = 'menikah' -- mayoritas PPG
      // sudah menikah, itu bukan indikasi berhenti aktif. Meninggal Dunia & Pindah Sambung ke
      // Daerah Lain TETAP mengarsipkan meski PPG (kalau dilakukan Super Admin).
      const needsArchive = !!editTarget && !isPPGAdminLocked && (
        (form.status_pengguna === 'menikah' && !isTargetPPG) ||
        form.status_pengguna === 'meninggal_dunia' ||
        (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain')
      )

      // Target desa/kelompok dihitung SEKALI di sini, dipakai baik oleh payload akun
      // (/api/users, scope login) MAUPUN payload biodata (/api/generus, "tempat sambung
      // generus saat ini") -- FIX sinkronisasi: sebelumnya generus.desa_id/kelompok_id hanya
      // ikut diperbarui saat alur status "Pindah Sambung" resmi, sehingga mengedit field
      // "Alamat Sambung" secara normal (tanpa mengubah status_pengguna) meninggalkan
      // generus.desa_id/kelompok_id basi dibanding users.desa_id/kelompok_id yang sudah
      // berpindah. Sekarang keduanya SELALU dikirim bersamaan dengan nilai target yang identik.
      const targetDesaId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_desa_id)
        ? form.pindah_desa_id
        : form.desa_id
      const targetKelompokId = (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur' && form.pindah_kelompok_id)
        ? form.pindah_kelompok_id
        : form.kelompok_id

      // Field pembuatan awal -- wajib dikirim saat CREATE (dipakai generate login_username &
      // password), TIDAK PERNAH lagi dikirim lewat blok ini saat EDIT (biodata existing user
      // dikirim lewat biodataFields di bawah, yang sudah dipre-fill dari data terbaru saat
      // openEdit() -- bukan dibawa mentah dari state form lama, jadi tidak berisiko menimpa
      // dengan data basi).
      const generusFieldsCreateOnly = !editTarget ? {
        nama_panggilan: form.nama_panggilan || null,
        tempat_lahir: form.tempat_lahir || null,
        tanggal_lahir: form.tanggal_lahir,
        jenis_kelamin: form.jenis_kelamin,
      } : {}

      // Status keanggotaan (Status Akun, Status Pengguna, pindah sambung) -- murni urusan
      // akun/status, tetap di tab "Akun". Dikosongkan total kalau isPPGAdminLocked (server
      // akan menolaknya juga, tapi client tidak perlu mengirim field yang toh pasti ditolak).
      const akunStatusFields = (editTarget && !isPPGAdminLocked) ? {
        status_anggota: form.status_anggota,
        status_pengguna: form.status_pengguna,
        pindah_desa_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_desa_id || null : null,
        pindah_kelompok_id: (form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') ? form.pindah_kelompok_id || null : null,
        pindah_ke_daerah_lain: form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'daerah_lain',
      } : {}

      // Biodata lengkap (tab "Biodata") -- hanya utk Generus/pengurus, TIDAK utk PPG (biodata
      // PPG dikelola terpisah lewat menu Data Pembina, lihat catatan di atas modul ini).
      const biodataFields = (editTarget && !isTargetPPG) ? {
        nama_panggilan: form.nama_panggilan || null,
        tempat_lahir: form.tempat_lahir || null,
        tanggal_lahir: form.tanggal_lahir || null,
        jenis_kelamin: form.jenis_kelamin || null,
        alamat: form.alamat || null,
        tinggi_badan: form.tinggi_badan ? parseFloat(form.tinggi_badan) : null,
        berat_badan: form.berat_badan ? parseFloat(form.berat_badan) : null,
        kelas_ngaji: form.kelas_ngaji || null,
        nama_ayah: form.nama_ayah || null,
        nama_ibu: form.nama_ibu || null,
        nama_wali: form.nama_wali || null,
        no_hp_orangtua_wali: form.no_hp_orangtua_wali || null,
        anak_ke: form.anak_ke ? parseInt(form.anak_ke) : null,
        jumlah_saudara: form.jumlah_saudara ? parseInt(form.jumlah_saudara) : null,
      } : {}

      // Sinkronisasi tempat sambung generus (lihat catatan targetDesaId/targetKelompokId di
      // atas) -- dikirim setiap kali edit user existing, terlepas dari tab mana yang sedang
      // dibuka, supaya generus.desa_id/kelompok_id tidak pernah tertinggal dari users.desa_id/
      // kelompok_id.
      const desaSyncFields = editTarget ? { desa_id: targetDesaId || null, kelompok_id: targetKelompokId || null } : {}

      const generusFields = { ...generusFieldsCreateOnly, ...akunStatusFields, ...biodataFields, ...desaSyncFields }

      let userId = editTarget?.id

      if (!editTarget) {
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
        if (json.error && res.status !== 207) { setError(json.error); return }
        userId = json.userId
        setNewCredentials({
          nama: form.nama_lengkap,
          username: json.loginUsername,
          password: json.defaultPassword,
          biodataWarning: res.status === 207 ? json.error : undefined,
        })
      } else {
        const existingGenerus = editTarget.generus

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

        // BIODATA & status keanggotaan -- lewat /api/generus.
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
          if (jsonGenerus.newLoginUsername) {
            setUsernameChangedNotice({ nama: form.nama_lengkap, username: jsonGenerus.newLoginUsername })
          }
        }
      }

      if (user) {
        await logAudit(
          user,
          editTarget ? 'UPDATE' : 'CREATE',
          'Pengguna',
          form.nama_lengkap,
          {
            email: form.email,
            role_id: form.role_id,
            status_pengguna: form.status_pengguna,
            // Ikut dicatat utk edit existing user -- sebelumnya perubahan is_active lewat modal
            // (beda dari tombol cepat toggleActive yang sudah eksplisit log ACTIVATE/DEACTIVATE)
            // tidak tercermin di detail log sama sekali, menyulitkan investigasi kapan/oleh siapa
            // status aktif berubah saat diedit bersamaan field lain. Nilainya SAMA PERSIS dengan
            // body.is_active yang benar-benar dikirim ke /api/users di atas.
            ...(editTarget ? { is_active: needsArchive ? false : form.is_active } : {}),
          },
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

    const isTargetPPGForSave = editTarget?.roles?.tingkatan === 'ppg'
    const isPPGAdminLockedForSave = isTargetPPGForSave && !isSuperAdmin

    // Validasi pindah sambung Bekasi Timur
    if (editTarget && !isPPGAdminLockedForSave && form.status_pengguna === 'pindah_sambung' && form.pindah_jenis === 'bekasi_timur') {
      if (!form.pindah_desa_id) { setError('Pilih desa tujuan pindah sambung'); return }
      if (!form.pindah_kelompok_id) { setError('Pilih kelompok tujuan pindah sambung'); return }
    }

    const needsArchive = !!editTarget && !isPPGAdminLockedForSave && (
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
      setNotice('Akun Super Admin tidak dapat dinonaktifkan.')
      return
    }
    if (m.roles?.tingkatan === 'ppg' && !isSuperAdmin) {
      setNotice('Status akun PPG hanya dapat diubah oleh Super Admin.')
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

  // Memulihkan akun yang sebelumnya diarsipkan -- dipanggil setelah konfirmasi lewat Modal
  // restoreTarget di bawah (menggantikan window.confirm() bawaan browser).
  const confirmRestore = async () => {
    const m = restoreTarget
    if (!m) return
    setRestoreTarget(null)
    const res = await authFetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: m.id, nama_lengkap: m.nama_lengkap, restore: true }),
    })
    const json = await res.json()
    if (json.error) { setNotice(json.error); return }

    if (m.generus?.id) {
      const resGenerus = await authFetch('/api/generus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: m.id,
          generus_id: m.generus.id,
          status_pengguna: 'lajang',
          pindah_desa_id: null,
          pindah_kelompok_id: null,
          pindah_ke_daerah_lain: false,
        }),
      })
      const jsonGenerus = await resGenerus.json()
      if (jsonGenerus.error) { setNotice(jsonGenerus.error); return }
    }

    if (user) {
      await logAudit(user, 'ACTIVATE', 'Pengguna', m.nama_lengkap, { alasan: 'Dipulihkan dari arsip' }, m.id)
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
      const matchStatus = !filterStatus ||
        (filterStatus === 'diarsipkan' && m.is_archived) ||
        (filterStatus === 'aktif' && !m.is_archived && m.is_active) ||
        (filterStatus === 'nonaktif' && !m.is_archived && !m.is_active)
      return matchSearch && matchRole && matchStatus
    })
    .sort((a, b) => {
      if (sortBy === 'nama_asc') return (a.nama_lengkap || '').localeCompare(b.nama_lengkap || '')
      if (sortBy === 'nama_desc') return (b.nama_lengkap || '').localeCompare(a.nama_lengkap || '')
      if (sortBy === 'terbaru') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      return 0
    })

  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  // Hanya Ketua/Wakil Ketua/Sekretaris (semua scope) dan Super Admin yang bisa mengelola
  // Generus -- lihat canManageMembers di lib/roles.ts.
  const canManageMembers = checkCanManageMembers(user)

  const canActOn = (m: Member): boolean => {
    if (!canManageMembers) return false
    if (isSuperAdmin || user?.role?.tingkatan === 'daerah') return true
    if (user?.role?.tingkatan === 'desa') return m.desa_id === user?.desa_id
    if (user?.role?.tingkatan === 'kelompok') return m.kelompok_id === user?.kelompok_id
    return false
  }

  const canManage = canManageMembers

  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu "Data Generus" utk
  // jenjang role user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok di sini.
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'generus')
  // Toggle terpisah utk tab "Biodata" + tombol export -- dulu menggerbangi seluruh halaman
  // "Data Generus", sekarang menggerbangi bagian biodata di dalam halaman gabungan ini saja,
  // supaya Super Admin tetap bisa mematikan visibilitas biodata utk jenjang tertentu tanpa
  // ikut mematikan menu akun.
  const { enabled: biodataEnabled } = useFeatureAccess(user, 'data-generus')

  const buildExportData = () => filtered
    .filter(m => m.roles?.tingkatan !== 'ppg')
    .map(m => {
      const g = m.generus
      const ttl = g?.tempat_lahir && g?.tanggal_lahir
        ? `${g.tempat_lahir}, ${new Date(g.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
        : (g?.tempat_lahir || '-')
      return {
        no: g?.nomor_generus || '-',
        nama: m.nama_lengkap || '-',
        panggilan: g?.nama_panggilan || '-',
        jk: g?.jenis_kelamin?.toUpperCase() || '-',
        ttl,
        kelas_ngaji: g?.kelas_ngaji ? (kelasNgajiLabel[g.kelas_ngaji] || g.kelas_ngaji) : '-',
        alamat: g?.alamat || '-',
        nama_ayah: g?.nama_ayah || '-',
        nama_ibu: g?.nama_ibu || '-',
        hp_ortu: g?.no_hp_orangtua_wali || '-',
        desa: m.desa?.nama_desa || '-',
        kelompok: m.kelompok?.nama_kelompok || '-',
      }
    })

  const exportSubtitle = () => {
    const t = user?.role?.tingkatan
    const scope = t === 'kelompok' ? user?.kelompok_id && data[0]?.kelompok?.nama_kelompok
      : t === 'desa' ? user?.desa_id && data[0]?.desa?.nama_desa
      : 'Se-Bekasi Timur'
    const rows = buildExportData()
    return `${scope || 'Se-Bekasi Timur'} -- ${rows.length} Generus`
  }

  const handleExportPDF = async () => {
    const rows = buildExportData()
    if (rows.length === 0) { setNotice('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      exportToPDF({
        title: 'Data Generus (Biodata)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows,
        fileName: `Data-Generus-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Generus', `PDF -- ${rows.length} generus`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportExcel = async () => {
    const rows = buildExportData()
    if (rows.length === 0) { setNotice('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      await exportToExcel({
        title: 'Data Generus (Biodata)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows,
        fileName: `Data-Generus-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Generus', `Excel -- ${rows.length} generus`)
    } finally {
      setExporting(false)
    }
  }

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Data Generus saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  const editIsPPG = editTarget?.roles?.tingkatan === 'ppg'
  const editPPGAdminLocked = editIsPPG && !isSuperAdmin
  const showBiodataTab = !!editTarget && !editIsPPG && biodataEnabled
  const biodataLengkap = (m: Member) => {
    const g = m.generus
    return !!(g?.tempat_lahir && g?.tanggal_lahir && g?.jenis_kelamin && g?.alamat && g?.nama_ayah && g?.nama_ibu)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Data Generus</h2>
          <p className="text-slate-400 text-sm">{data.length} Generus & Pengurus terdaftar se-Bekasi Timur -- akun & biodata dalam satu tempat</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && biodataEnabled && (
            <>
              <button onClick={handleExportPDF} disabled={exporting}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
                📄 PDF
              </button>
              <button onClick={handleExportExcel} disabled={exporting}
                className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
                📊 Excel
              </button>
            </>
          )}
          {canManage && (
            <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Generus
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
          <option value="">Semua Jenjang</option>
          <option value="daerah">Daerah</option>
          <option value="desa">Desa</option>
          <option value="kelompok">Kelompok</option>
          <option value="ppg">PPG</option>
        </select>
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as typeof filterStatus)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="">Semua Status</option>
          <option value="aktif">Aktif</option>
          <option value="nonaktif">Non-aktif</option>
          <option value="diarsipkan">Diarsipkan</option>
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
          <p>Belum ada Generus terdaftar</p>
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
                  const rowIsPPG = m.roles?.tingkatan === 'ppg'
                  const ppgLocked = rowIsPPG && !isSuperAdmin
                  return (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50 transition cursor-pointer"
                      onClick={() => setDetailModal(m)}>
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
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        {canActOn(m) ? (
                          <div className="flex gap-3">
                            <button onClick={() => openEdit(m)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                            {!m.is_archived && (!ppgLocked) && (
                              <button onClick={() => toggleActive(m)} className={`text-xs font-medium ${m.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                                {m.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                              </button>
                            )}
                            {ppgLocked && !m.is_archived && (
                              <span className="text-xs text-slate-300 italic" title="Status akun PPG hanya dapat diubah Super Admin">Terkunci</span>
                            )}
                            {m.is_archived && !ppgLocked && (
                              <button onClick={() => setRestoreTarget(m)} className="text-orange-500 hover:text-orange-700 font-medium text-xs">
                                Pulihkan
                              </button>
                            )}
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300 italic">Hanya lihat</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal -- terbuka utk siapapun yang bisa melihat halaman ini (view-only bagi
          yang bukan Ketua/Wakil/Sekretaris/Super Admin, sebelumnya hanya bisa dibuka manager). */}
      {detailModal && (
        <Modal open={!!detailModal} onClose={() => setDetailModal(null)} title="Detail Generus" size="lg">
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
                  {detailModal.roles?.tingkatan !== 'ppg' && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${biodataLengkap(detailModal) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      Biodata {biodataLengkap(detailModal) ? 'Lengkap' : 'Belum Lengkap'}
                    </span>
                  )}
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
                { label: 'No. HP', val: detailModal.no_hp },
                { label: 'Bergabung Sejak', val: new Date(detailModal.created_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) },
                { label: 'Status Akun', val: detailModal.is_archived ? 'Diarsipkan' : detailModal.is_active ? 'Aktif' : 'Non-aktif' },
                { label: 'Status Generus', val: detailModal.generus?.status?.toUpperCase() },
                { label: 'Jenis Kelamin', val: detailModal.generus?.jenis_kelamin?.toUpperCase() },
                { label: 'Usia', val: detailModal.generus?.tanggal_lahir ? formatAge(detailModal.generus.tanggal_lahir) : null },
                { label: 'Kelas Ngaji', val: detailModal.generus?.kelas_ngaji ? (kelasNgajiLabel[detailModal.generus.kelas_ngaji] || detailModal.generus.kelas_ngaji) : null },
                { label: 'Alamat', val: detailModal.generus?.alamat },
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
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? `Edit ${editTarget.nama_lengkap}` : 'Tambah Generus'} size="lg">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          {showBiodataTab && (
            <div className="flex gap-1 p-1 bg-slate-100 rounded-xl w-fit">
              <button type="button" onClick={() => setActiveTab('akun')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${activeTab === 'akun' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Akun
              </button>
              <button type="button" onClick={() => setActiveTab('biodata')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition flex items-center gap-1.5 ${activeTab === 'biodata' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                Biodata
                {editTarget && (
                  <span className={`w-1.5 h-1.5 rounded-full ${biodataLengkap(editTarget) ? 'bg-green-500' : 'bg-amber-500'}`} />
                )}
              </button>
            </div>
          )}

          {(!showBiodataTab || activeTab === 'akun') && (
            <div className="space-y-4">
              {!editTarget && (
                <>
                  <div className="p-2 bg-blue-50 rounded-xl border border-blue-100">
                    <span className="text-xs text-blue-500">
                      Nama & tanggal lahir dipakai sistem untuk membuat Nama Pengguna dan password awal akun. Biodata lengkap (alamat, data orang tua, dll) dilengkapi nanti di tab &quot;Biodata&quot; setelah akun dibuat.
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
                  {roleList
                    .filter(r => getAllowedTargetTingkatan(user).includes(r.tingkatan))
                    .map(r => <option key={r.id} value={r.id}>{r.nama_role}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Email * (untuk notifikasi sistem)</label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="email@domain.com"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">No. HP</label>
                  <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)} placeholder="08xx-xxxx-xxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <p className="text-[11px] text-slate-400 -mt-2">
                Login sehari-hari memakai Nama Pengguna, bukan email ini — email hanya dipakai sistem untuk mengirim notifikasi (pengumuman, kegiatan, dsb).
              </p>

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
                    <PasswordInput value={form.password} onChange={v => set('password', v)}
                      placeholder="Kosongkan jika tidak diubah" autoComplete="new-password"
                      className="w-full pl-3 pr-10 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
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

              {editTarget && editPPGAdminLocked && (
                <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600 text-xs leading-relaxed">
                  Status keanggotaan (Status Akun/Status Pengguna) akun PPG hanya dapat diubah oleh Super Admin -- PPG adalah pengawas di atas jenjang Daerah, bukan bawahan yang dikelola Ketua/Sekretaris Daerah. Biodata PPG dikelola lewat menu &quot;Data Pembina&quot;.
                </div>
              )}

              {editTarget && !editPPGAdminLocked && (
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
                      Akun PPG tidak diarsipkan otomatis saat berstatus &quot;Menikah&quot; -- status hanya dicatat sebagai info biodata, akun tetap aktif seperti biasa.
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
          )}

          {showBiodataTab && activeTab === 'biodata' && editTarget && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                <span className="text-xs text-slate-400">No. Generus</span>
                <span className="font-mono text-sm font-semibold text-slate-600">{editTarget.generus?.nomor_generus || '—'}</span>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Panggilan (huruf kapital)</label>
                <input value={form.nama_panggilan}
                  onChange={e => setUpper('nama_panggilan', e.target.value)}
                  placeholder="NAMA PANGGILAN"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                <p className="text-[11px] text-amber-600 mt-1">Mengubah nama panggilan akan ikut mengubah Nama Pengguna (login) -- pengguna akan diberi tahu nama login barunya, password tidak berubah.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tempat Lahir (huruf kapital)</label>
                  <input value={form.tempat_lahir}
                    onChange={e => setUpper('tempat_lahir', e.target.value)}
                    placeholder="KOTA/KABUPATEN"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                </div>
                <div>
                  <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 mb-1">
                    Tanggal Lahir
                    {form.tanggal_lahir && (
                      <span className="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-600 text-[10px] font-semibold normal-case">
                        {formatAge(form.tanggal_lahir)}
                      </span>
                    )}
                  </label>
                  <input type="date" value={form.tanggal_lahir} onChange={e => set('tanggal_lahir', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin</label>
                  <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih --</option>
                    <option value="laki-laki">LAKI-LAKI</option>
                    <option value="perempuan">PEREMPUAN</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Kelas Ngaji</label>
                  <select value={form.kelas_ngaji} onChange={e => set('kelas_ngaji', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">-- Pilih --</option>
                    <option value="pra_remaja">{kelasNgajiLabel.pra_remaja}</option>
                    <option value="remaja_muda">{kelasNgajiLabel.remaja_muda}</option>
                    <option value="remaja_dewasa">{kelasNgajiLabel.remaja_dewasa}</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tinggi Badan (cm)</label>
                  <input type="number" min="0" step="0.1" value={form.tinggi_badan} onChange={e => set('tinggi_badan', e.target.value)}
                    placeholder="opsional"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Berat Badan (kg)</label>
                  <input type="number" min="0" step="0.1" value={form.berat_badan} onChange={e => set('berat_badan', e.target.value)}
                    placeholder="opsional"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat (huruf kapital)</label>
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ayah Kandung (huruf kapital)</label>
                    <input value={form.nama_ayah}
                      onChange={e => setUpper('nama_ayah', e.target.value)}
                      placeholder="NAMA AYAH"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ibu Kandung (huruf kapital)</label>
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">No. HP Orang Tua</label>
                    <input value={form.no_hp_orangtua_wali} onChange={e => set('no_hp_orangtua_wali', e.target.value)}
                      placeholder="08xx-xxxx-xxxx"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
              </div>
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

      {/* Confirmation Modal (arsip 2-langkah) */}
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

      {/* Konfirmasi Pulihkan akun */}
      {restoreTarget && (
        <Modal open={!!restoreTarget} onClose={() => setRestoreTarget(null)} title="Pulihkan Akun" size="sm">
          <div className="space-y-4">
            <p className="text-slate-700 text-sm leading-relaxed">
              Pulihkan akun <strong>{restoreTarget.nama_lengkap}</strong>? Akun akan diaktifkan kembali dengan status &quot;Lajang&quot;.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setRestoreTarget(null)}
                className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                Batal
              </button>
              <button onClick={confirmRestore}
                className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-medium hover:bg-orange-600 transition">
                Ya, Pulihkan
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Notice satu-tombol (pengganti window.alert()) */}
      {notice && (
        <Modal open={!!notice} onClose={() => setNotice(null)} title="Informasi" size="sm">
          <div className="space-y-4">
            <p className="text-slate-700 text-sm leading-relaxed">{notice}</p>
            <button onClick={() => setNotice(null)}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition">
              Mengerti
            </button>
          </div>
        </Modal>
      )}

      {/* Modal kredensial akun baru */}
      {newCredentials && (
        <Modal open={!!newCredentials} onClose={() => setNewCredentials(null)} title="Generus Berhasil Dibuat" size="sm">
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

      {/* Modal pemberitahuan nama login berubah */}
      {usernameChangedNotice && (
        <Modal open={!!usernameChangedNotice} onClose={() => setUsernameChangedNotice(null)} title="Nama Login Diperbarui" size="sm">
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Nama panggilan <span className="font-semibold">{usernameChangedNotice.nama}</span> berubah, jadi nama login-nya ikut diperbarui. Sampaikan nama login baru ini ke pengguna (password tidak berubah):
            </p>
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
              <p className="text-xs text-slate-400 mb-0.5">Nama Pengguna Baru (untuk login)</p>
              <p className="font-mono font-semibold text-slate-800">{usernameChangedNotice.username}</p>
            </div>
            <button onClick={() => setUsernameChangedNotice(null)}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition">
              Sudah Dicatat
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
