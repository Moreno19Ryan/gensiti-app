'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { authFetch } from '@/lib/auth'
import { canManageMembers as checkCanManageMembers, canViewGenerusData } from '@/lib/roles'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { formatAge } from '@/lib/date'
import Modal from '@/components/Modal'
import { exportToPDF, exportToExcel } from '@/lib/export'

// Halaman KHUSUS biodata PPG (Penggerak Pembina Generus) -- dipisah dari menu "Data Generus"
// karena PPG adalah pembina, BUKAN Generus (tidak punya kelas ngaji, tidak berada dalam
// struktur keanggotaan Generus kelompok/desa/daerah). Sebelumnya PPG ikut tercampur tampil
// di antara data Generus asli di /data-generus, yang membingungkan secara konsep meski
// secara database keduanya sama-sama punya baris di tabel generus (dipakai bersama utk
// mekanisme login_username/password & nomor identitas). Field di sini sengaja LEBIH RINGKAS
// dari Data Generus -- tanpa Kelas Ngaji (tidak relevan) dan tanpa data orang tua/wali/anak
// ke-/jumlah saudara (PPG sudah dewasa, bukan anak asuh organisasi) -- hanya biodata inti
// yang relevan utk pembina: nama panggilan, no HP, TTL, jenis kelamin, alamat, tinggi/berat.
// Hak akses SAMA seperti Data Generus (canViewGenerusData utk lihat, canManageMembers utk
// edit) -- ini murni pemisahan tampilan/menu berdasarkan jenis biodata, bukan hak akses baru.
interface PembinaRow {
  id: string
  user_id: string
  nomor_generus: string
  nama_panggilan: string | null
  tempat_lahir: string | null
  tanggal_lahir: string | null
  jenis_kelamin: string | null
  alamat: string | null
  tinggi_badan: number | null
  berat_badan: number | null
  status_pengguna: string | null
  users: {
    id: string
    nama_lengkap: string
    no_hp: string | null
    is_active: boolean
    is_archived: boolean
    desa: { id: string; nama_desa: string } | null
    kelompok: { id: string; nama_kelompok: string } | null
    roles: { nama_role: string; tingkatan: string } | null
  } | null
}

const statusPenggunaLabel: Record<string, string> = {
  lajang: 'Lajang',
  menikah: 'Menikah',
  pindah_sambung: 'Pindah Sambung',
  meninggal_dunia: 'Meninggal Dunia',
}

const statusPenggunaBadge: Record<string, string> = {
  lajang: 'bg-blue-100 text-blue-700',
  menikah: 'bg-emerald-100 text-emerald-700',
  pindah_sambung: 'bg-amber-100 text-amber-700',
  meninggal_dunia: 'bg-slate-100 text-slate-600',
}

const emptyForm = {
  nama_panggilan: '',
  no_hp: '',
  tempat_lahir: '',
  tanggal_lahir: '',
  jenis_kelamin: '',
  alamat: '',
  tinggi_badan: '',
  berat_badan: '',
  status_pengguna: 'lajang',
}

export default function DataPembinaPage() {
  const { user } = useUser()
  const [data, setData] = useState<PembinaRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<PembinaRow | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)
  // Diisi kalau /api/generus PATCH mengembalikan newLoginUsername (nama_panggilan berubah,
  // login_username ikut disinkronkan otomatis -- lihat komentar di app/api/generus/route.ts).
  const [usernameChangedNotice, setUsernameChangedNotice] = useState<{ nama: string; username: string } | null>(null)

  const canManage = checkCanManageMembers(user)
  // Sama seperti Data Generus: Super Admin + semua Pengurus Muda-Mudi + PPG boleh melihat.
  // Generus biasa tidak boleh mengakses sama sekali.
  const hasAccess = canViewGenerusData(user)
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'data-pembina')

  const loadData = useCallback(async () => {
    if (!hasAccess) return
    setLoading(true)
    // PPG (Penggerak Pembina Generus) berada di jenjang Daerah/atas -- tidak terikat scope
    // desa/kelompok pengurus seperti Generus biasa, jadi TIDAK ada filter desa/kelompok di
    // sini (beda dari data-generus/page.tsx). Semua yang lolos hasAccess (Super Admin +
    // seluruh Pengurus Muda-Mudi di jenjang manapun + PPG sendiri) melihat daftar PPG yang sama.
    const { data: rows, error: err } = await supabase
      .from('generus')
      .select(`
        id, user_id, nomor_generus, nama_panggilan, tempat_lahir, tanggal_lahir, jenis_kelamin,
        alamat, tinggi_badan, berat_badan, status_pengguna,
        users:user_id(id, nama_lengkap, no_hp, is_active, is_archived, desa:desa_id(id, nama_desa), kelompok:kelompok_id(id, nama_kelompok), roles:role_id(nama_role, tingkatan))
      `)
      .order('nomor_generus')

    if (err) console.error('Data Pembina load error:', err)
    const filtered = ((rows as unknown as PembinaRow[]) || []).filter(
      g => g.users?.roles?.tingkatan === 'ppg'
    )
    setData(filtered)
    setLoading(false)
  }, [hasAccess])

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [user, loadData])

  const openEdit = (g: PembinaRow) => {
    setEditTarget(g)
    setError('')
    setForm({
      nama_panggilan: g.nama_panggilan || '',
      no_hp: g.users?.no_hp || '',
      tempat_lahir: g.tempat_lahir || '',
      tanggal_lahir: g.tanggal_lahir || '',
      jenis_kelamin: g.jenis_kelamin || '',
      alamat: g.alamat || '',
      tinggi_badan: g.tinggi_badan?.toString() || '',
      berat_badan: g.berat_badan?.toString() || '',
      status_pengguna: g.status_pengguna || 'lajang',
    })
  }

  // Memulihkan akun PPG yang sebelumnya diarsipkan (satu-satunya jalur arsip otomatis di
  // halaman ini adalah status_pengguna = 'meninggal_dunia', lihat needsArchive di handleSave
  // -- PPG DIKECUALIKAN dari arsip otomatis saat 'menikah'). Pola & pembagian tanggung jawab
  // endpoint PERSIS sama dengan restoreAccount() di app/(dashboard)/generus/page.tsx (/api/users
  // murni field akun, /api/generus murni biodata, status_pengguna selalu direset ke 'lajang').
  // Sebelum fix ini, akun PPG yang diarsipkan tidak punya jalur pemulihan sama sekali di UI --
  // halaman ini bahkan tidak mengambil is_active/is_archived dari database, jadi status arsip
  // PPG tidak pernah terlihat di sini walau datanya sudah diarsipkan lewat handleSave.
  const restoreAccount = async (g: PembinaRow) => {
    if (!g.users) return
    const nama = g.users.nama_lengkap
    if (!confirm(`Pulihkan akun "${nama}"? Akun akan diaktifkan kembali dengan status "Lajang".`)) return
    const res = await authFetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: g.users.id, nama_lengkap: nama, restore: true }),
    })
    const json = await res.json()
    if (json.error) { alert(json.error); return }

    const resGenerus = await authFetch('/api/generus', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: g.users.id,
        generus_id: g.id,
        status_pengguna: 'lajang',
      }),
    })
    const jsonGenerus = await resGenerus.json()
    if (jsonGenerus.error) { alert(jsonGenerus.error); return }

    if (user) {
      await logAudit(user, 'ACTIVATE', 'Pengguna', nama, { alasan: 'Dipulihkan dari arsip' }, g.users.id)
    }
    loadData()
  }

  const set = (key: string, val: string) => setForm(f => ({ ...f, [key]: val }))
  const setUpper = (key: string, val: string) => setForm(f => ({ ...f, [key]: val.toUpperCase() }))

  const handleSave = async () => {
    if (!editTarget?.users) return
    setError('')
    if (!form.nama_panggilan) { setError('Nama panggilan wajib diisi'); return }
    if (!form.tempat_lahir) { setError('Tempat lahir wajib diisi'); return }
    if (!form.tanggal_lahir) { setError('Tanggal lahir wajib diisi'); return }
    if (!form.jenis_kelamin) { setError('Jenis kelamin wajib diisi'); return }
    if (!form.alamat) { setError('Alamat wajib diisi'); return }
    if (!form.no_hp) { setError('No. HP pribadi wajib diisi'); return }

    setSaving(true)
    try {
      // PPG dikecualikan dari arsip otomatis saat status_pengguna = 'menikah' -- mayoritas
      // pengurus PPG sudah menikah, itu bukan indikasi ybs berhenti aktif (sama seperti
      // logika di generus/page.tsx doActualSave). Meninggal Dunia TETAP mengarsipkan --
      // kondisi itu memang berarti ybs sudah tidak bisa lagi menjalankan tugasnya. Halaman
      // ini tidak punya opsi "Pindah Sambung" (PPG tidak terikat scope desa/kelompok).
      const needsArchive = form.status_pengguna === 'meninggal_dunia'

      // no_hp + status akun (archive kalau perlu) adalah field AKUN (tabel users) -- lewat
      // /api/users. Sisanya biodata murni -- lewat /api/generus. Sama seperti pola di
      // data-generus/page.tsx.
      const akunBody: Record<string, unknown> = { id: editTarget.users.id, no_hp: form.no_hp }
      if (needsArchive) {
        akunBody.is_active = false
        akunBody.archive = true
        akunBody.alasan_arsip = 'Meninggal Dunia'
      }
      const resAkun = await authFetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(akunBody),
      })
      const jsonAkun = await resAkun.json()
      if (jsonAkun.error) { setError(jsonAkun.error); return }

      const res = await authFetch('/api/generus', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: editTarget.users.id,
          generus_id: editTarget.id,
          nama_panggilan: form.nama_panggilan,
          tempat_lahir: form.tempat_lahir,
          tanggal_lahir: form.tanggal_lahir,
          jenis_kelamin: form.jenis_kelamin,
          alamat: form.alamat,
          tinggi_badan: form.tinggi_badan ? parseFloat(form.tinggi_badan) : null,
          berat_badan: form.berat_badan ? parseFloat(form.berat_badan) : null,
          status_pengguna: form.status_pengguna,
        }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      if (json.newLoginUsername) {
        setUsernameChangedNotice({ nama: editTarget.users.nama_lengkap, username: json.newLoginUsername })
      }

      if (user) {
        await logAudit(user, 'UPDATE', 'Data Pembina', editTarget.users.nama_lengkap, {}, editTarget.users.id)
      }
      setEditTarget(null)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const exportColumns = [
    { header: 'No. PPG', key: 'no', width: 14 },
    { header: 'Nama Lengkap', key: 'nama', width: 26 },
    { header: 'Nama Panggilan', key: 'panggilan', width: 18 },
    { header: 'Jenis Kelamin', key: 'jk', width: 14 },
    { header: 'Tempat, Tgl Lahir', key: 'ttl', width: 24 },
    { header: 'Alamat', key: 'alamat', width: 30 },
    { header: 'No. HP', key: 'no_hp', width: 18 },
    { header: 'Status Pengguna', key: 'status_pengguna', width: 16 },
    { header: 'Desa', key: 'desa', width: 18 },
    { header: 'Kelompok', key: 'kelompok', width: 18 },
  ]

  const buildExportData = () => filtered.map(g => {
    const ttl = g.tempat_lahir && g.tanggal_lahir
      ? `${g.tempat_lahir}, ${new Date(g.tanggal_lahir).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : (g.tempat_lahir || '-')
    return {
      no: g.nomor_generus || '-',
      nama: g.users?.nama_lengkap || '-',
      panggilan: g.nama_panggilan || '-',
      jk: g.jenis_kelamin?.toUpperCase() || '-',
      ttl,
      alamat: g.alamat || '-',
      no_hp: g.users?.no_hp || '-',
      status_pengguna: g.status_pengguna ? (statusPenggunaLabel[g.status_pengguna] || g.status_pengguna) : '-',
      desa: g.users?.desa?.nama_desa || '-',
      kelompok: g.users?.kelompok?.nama_kelompok || '-',
    }
  })

  const exportSubtitle = () => `Se-Bekasi Timur -- ${filtered.length} Pembina (PPG)`

  const handleExportPDF = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      exportToPDF({
        title: 'Data Pembina (PPG)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Data-Pembina-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Pembina', `PDF -- ${filtered.length} pembina`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportExcel = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      await exportToExcel({
        title: 'Data Pembina (PPG)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Data-Pembina-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Pembina', `Excel -- ${filtered.length} pembina`)
    } finally {
      setExporting(false)
    }
  }

  const filtered = data.filter(g => {
    const q = search.toLowerCase()
    if (!q) return true
    return (
      g.users?.nama_lengkap?.toLowerCase().includes(q) ||
      g.nomor_generus?.toLowerCase().includes(q) ||
      g.users?.desa?.nama_desa?.toLowerCase().includes(q) ||
      g.users?.kelompok?.nama_kelompok?.toLowerCase().includes(q)
    )
  })

  if (!hasAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Data Pembina hanya tersedia untuk Pengurus dan PPG.</p>
      </div>
    )
  }

  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu ini utk jenjang role
  // user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok di sini. PPG sendiri
  // tidak punya toggle utk menu ini krn ini biodatanya sendiri (lihat seed migrasi -- data-
  // pembina TETAP di-seed utk 'ppg' krn PPG lain mungkin ingin dimatikan aksesnya oleh SA,
  // meski jarang -- tetap konsisten dgn desain "gerbang tambahan", bukan pengecualian khusus).
  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Data Pembina saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Data Pembina</h2>
          <p className="text-slate-400 text-sm">Biodata pribadi {data.length} Pembina (PPG) -- terpisah dari Data Generus</p>
        </div>
        {canManage && (
          <div className="flex items-center gap-2">
            <button onClick={handleExportPDF} disabled={exporting}
              className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
              📄 PDF
            </button>
            <button onClick={handleExportExcel} disabled={exporting}
              className="px-3 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
              📊 Excel
            </button>
          </div>
        )}
      </div>

      <input type="text" placeholder="Cari nama, no. PPG, desa, kelompok..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🛡️</div>
          <p>Belum ada data Pembina</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Pembina</th>
                  <th className="px-4 py-3 font-medium">No. PPG</th>
                  <th className="px-4 py-3 font-medium">Desa / Kelompok</th>
                  <th className="px-4 py-3 font-medium">Jenis Kelamin</th>
                  <th className="px-4 py-3 font-medium">Usia</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Kelengkapan</th>
                  {canManage && <th className="px-4 py-3 font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => {
                  const lengkap = !!(g.tempat_lahir && g.tanggal_lahir && g.jenis_kelamin && g.alamat)
                  const sp = g.status_pengguna || 'lajang'
                  return (
                    <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center text-purple-700 font-bold text-sm shrink-0">
                            {g.users?.nama_lengkap?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="font-medium text-slate-800">{g.users?.nama_lengkap}</div>
                            {g.nama_panggilan && <div className="text-slate-400 text-xs">{g.nama_panggilan}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{g.nomor_generus || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <div>{g.users?.desa?.nama_desa || '—'}</div>
                        {g.users?.kelompok && <div className="text-slate-400">{g.users.kelompok.nama_kelompok}</div>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{g.jenis_kelamin?.toUpperCase() || '—'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{g.tanggal_lahir ? formatAge(g.tanggal_lahir) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1 w-fit">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium w-fit ${statusPenggunaBadge[sp]}`}>
                            {statusPenggunaLabel[sp]}
                          </span>
                          {g.users?.is_archived && (
                            <span className="px-2 py-0.5 rounded-full text-xs font-medium w-fit bg-orange-100 text-orange-700">
                              Diarsipkan
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${lengkap ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {lengkap ? 'Lengkap' : 'Belum Lengkap'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <button onClick={() => openEdit(g)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">
                              Lihat / Edit
                            </button>
                            {g.users?.is_archived && (
                              <button onClick={() => restoreAccount(g)} className="text-orange-500 hover:text-orange-700 font-medium text-xs">
                                Pulihkan
                              </button>
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

      {editTarget && (
        <Modal open={!!editTarget} onClose={() => setEditTarget(null)} title={`Biodata ${editTarget.users?.nama_lengkap || ''}`} size="lg">
          <div className="space-y-4">
            {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

            <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-xs text-slate-400">No. PPG</span>
              <span className="font-mono text-sm font-semibold text-slate-600">{editTarget.nomor_generus}</span>
              {!canManage && <span className="text-xs text-slate-400 ml-auto">Hanya lihat</span>}
            </div>

            <fieldset disabled={!canManage} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Nama Panggilan * (huruf kapital)</label>
                  <input value={form.nama_panggilan}
                    onChange={e => setUpper('nama_panggilan', e.target.value)}
                    placeholder="NAMA PANGGILAN"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:opacity-60" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">No. HP Pribadi *</label>
                  <input value={form.no_hp} onChange={e => set('no_hp', e.target.value)} placeholder="08xx-xxxx-xxxx"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tempat Lahir * (huruf kapital)</label>
                  <input value={form.tempat_lahir}
                    onChange={e => setUpper('tempat_lahir', e.target.value)}
                    placeholder="KOTA/KABUPATEN"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:opacity-60" />
                </div>
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
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin *</label>
                <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                  <option value="">-- Pilih --</option>
                  {/* value HARUS lowercase -- kolom generus.jenis_kelamin dibatasi CHECK
                      constraint anggota_jenis_kelamin_check (hanya 'laki-laki'/'perempuan'). */}
                  <option value="laki-laki">LAKI-LAKI</option>
                  <option value="perempuan">PEREMPUAN</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Tinggi Badan (cm)</label>
                  <input type="number" min="0" step="0.1" value={form.tinggi_badan} onChange={e => set('tinggi_badan', e.target.value)}
                    placeholder="opsional"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Berat Badan (kg)</label>
                  <input type="number" min="0" step="0.1" value={form.berat_badan} onChange={e => set('berat_badan', e.target.value)}
                    placeholder="opsional"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat * (huruf kapital)</label>
                <textarea value={form.alamat} onChange={e => setUpper('alamat', e.target.value)}
                  rows={2} placeholder="ALAMAT LENGKAP"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none uppercase disabled:opacity-60" />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Status Pengguna</label>
                <select value={form.status_pengguna} onChange={e => set('status_pengguna', e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                  <option value="lajang">Lajang</option>
                  <option value="menikah">Menikah</option>
                  <option value="meninggal_dunia">Meninggal Dunia</option>
                </select>
                {form.status_pengguna === 'menikah' && (
                  <p className="text-xs text-emerald-600 mt-1.5">
                    ✓ Status &quot;Menikah&quot; tidak mengarsipkan akun PPG -- mayoritas pengurus PPG memang sudah menikah.
                  </p>
                )}
                {form.status_pengguna === 'meninggal_dunia' && (
                  <p className="text-xs text-red-600 mt-1.5">
                    ⚠️ Akun akan otomatis diarsipkan (dinonaktifkan) saat disimpan.
                  </p>
                )}
              </div>
            </fieldset>

            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button onClick={() => setEditTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                {canManage ? 'Batal' : 'Tutup'}
              </button>
              {canManage && (
                <button onClick={handleSave} disabled={saving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}

      {/* Modal pemberitahuan nama login berubah -- muncul setiap kali nama_panggilan diedit
          dan login_username disinkronkan ulang otomatis (lihat app/api/generus/route.ts).
          Password TIDAK berubah, hanya nama yang dipakai untuk login. */}
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
