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

// Halaman ini KHUSUS biodata Generus (data pribadi/sensitif) -- terpisah dari menu "Pengguna"
// yang murni akun (login, role, hak akses). Pemisahan ini disengaja: supaya yang mengelola
// akun tidak otomatis melihat data pribadi (alamat, nama orang tua, tempat lahir, dll) kalau
// tidak sedang perlu, dan sebaliknya. Hak akses TETAP SAMA seperti menu Pengguna
// (canManageMembers) -- ini murni pemisahan tampilan/menu, bukan perubahan hak akses.
interface GenerusRow {
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
  kelas_ngaji: string | null
  nama_ayah: string | null
  nama_ibu: string | null
  nama_wali: string | null
  no_hp_orangtua_wali: string | null
  anak_ke: number | null
  jumlah_saudara: number | null
  users: {
    id: string
    nama_lengkap: string
    no_hp: string | null
    desa: { id: string; nama_desa: string } | null
    kelompok: { id: string; nama_kelompok: string } | null
    roles: { nama_role: string; tingkatan: string } | null
  } | null
}

const kelasNgajiLabel: Record<string, string> = {
  pra_remaja: 'Pra Remaja (SMP)',
  remaja_muda: 'Remaja Muda (SMA)',
  remaja_dewasa: 'Remaja Dewasa (Lulus SMA - Usia Mandiri)',
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
  kelas_ngaji: '',
  nama_ayah: '',
  nama_ibu: '',
  nama_wali: '',
  no_hp_orangtua_wali: '',
  anak_ke: '',
  jumlah_saudara: '',
}

export default function DataGenerusPage() {
  const { user } = useUser()
  const [data, setData] = useState<GenerusRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editTarget, setEditTarget] = useState<GenerusRow | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [exporting, setExporting] = useState(false)

  const canManage = checkCanManageMembers(user)
  // Hak lihat: Super Admin + semua Pengurus Muda-Mudi (Ketua/Wakil/Sekretaris/Bendahara/
  // Kemandirian/Keputrian/dll) + PPG -- lihat definisi canViewGenerusData(). Generus biasa
  // TIDAK boleh mengakses halaman ini sama sekali (biodata sensitif). Guard render ada di
  // bawah, setelah semua hook -- RLS tabel generus juga sudah diperketat sejalan dgn ini.
  const hasAccess = canViewGenerusData(user)
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'data-generus')

  const loadData = useCallback(async () => {
    if (!hasAccess) return
    setLoading(true)
    let query = supabase
      .from('generus')
      .select(`
        id, user_id, nomor_generus, nama_panggilan, tempat_lahir, tanggal_lahir, jenis_kelamin,
        alamat, tinggi_badan, berat_badan, kelas_ngaji, nama_ayah, nama_ibu, nama_wali,
        no_hp_orangtua_wali, anak_ke, jumlah_saudara,
        users:user_id(id, nama_lengkap, no_hp, desa:desa_id(id, nama_desa), kelompok:kelompok_id(id, nama_kelompok), roles:role_id(nama_role, tingkatan))
      `)
      .order('nomor_generus')

    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('users.kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('users.desa_id', user.desa_id)
    }

    const { data: rows, error: err } = await query
    if (err) console.error('Data Generus load error:', err)
    // users bisa null kalau baris generus orphan (tidak ada akun terkait) atau tersaring
    // scope di atas (PostgREST tetap mengembalikan baris dgn embedded resource null,
    // bukan mengecualikan barisnya) -- keduanya difilter di sini, bukan cuma yang
    // roles.tingkatan super_admin. Scope desa/kelompok SENGAJA dicek ULANG secara eksplisit
    // di client (bukan hanya mengandalkan .eq() pada embedded resource di atas) -- meniru
    // pola defensif yang sama seperti di generus/page.tsx, karena filter pada relasi nested
    // lewat PostgREST pernah terbukti tidak selalu konsisten di production untuk kasus lain.
    // PPG DIKECUALIKAN dari halaman ini -- PPG adalah pembina, bukan Generus, jadi biodatanya
    // sekarang ditampilkan terpisah di menu "Data Pembina" (app/(dashboard)/data-pembina/page.tsx).
    // Sebelumnya PPG ikut tercampur di sini (mis. akun "Rizal Firdaus" muncul berdampingan
    // dengan Generus asli), padahal PPG tidak punya kelas_ngaji dan bukan bagian struktur
    // keanggotaan Generus sama sekali.
    const filtered = ((rows as unknown as GenerusRow[]) || []).filter(g => {
      if (!g.users || g.users.roles?.tingkatan === 'super_admin' || g.users.roles?.tingkatan === 'ppg') return false
      if (t === 'super_admin' || t === 'daerah') return true
      if (user?.kelompok_id) return g.users.kelompok?.id === user.kelompok_id
      if (user?.desa_id) return g.users.desa?.id === user.desa_id
      return false
    })
    setData(filtered)
    setLoading(false)
  }, [user, hasAccess])

  // Data-fetching on mount/dependency-change (bukan derived state) -- lihat catatan serupa
  // di dashboard/page.tsx. Disable per-baris supaya perilaku persis sama.
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [user, loadData])

  const openEdit = (g: GenerusRow) => {
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
      kelas_ngaji: g.kelas_ngaji || '',
      nama_ayah: g.nama_ayah || '',
      nama_ibu: g.nama_ibu || '',
      nama_wali: g.nama_wali || '',
      no_hp_orangtua_wali: g.no_hp_orangtua_wali || '',
      anak_ke: g.anak_ke?.toString() || '',
      jumlah_saudara: g.jumlah_saudara?.toString() || '',
    })
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
    if (!form.no_hp) { setError('No. HP pribadi wajib diisi (jika tidak punya, isi dengan no. HP aktif lain)'); return }
    const isKelasNgajiRelevant = editTarget.users.roles?.tingkatan !== 'ppg'
    if (isKelasNgajiRelevant && !form.kelas_ngaji) { setError('Kelas ngaji wajib dipilih'); return }
    if (!form.nama_ayah) { setError('Nama ayah kandung wajib diisi'); return }
    if (!form.nama_ibu) { setError('Nama ibu kandung wajib diisi'); return }
    if (!form.no_hp_orangtua_wali) { setError('No. HP orang tua wajib diisi'); return }

    setSaving(true)
    try {
      // no_hp adalah field AKUN (users.no_hp), bukan biodata -- lewat /api/users.
      // Sisanya biodata murni -- lewat /api/generus. Dua request terpisah karena kini
      // dua domain berbeda, tapi tetap dijalankan berurutan dari satu tombol Simpan
      // supaya pengalaman admin tidak berubah.
      const resAkun = await authFetch('/api/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editTarget.users.id, no_hp: form.no_hp }),
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
          kelas_ngaji: form.kelas_ngaji || null,
          nama_ayah: form.nama_ayah,
          nama_ibu: form.nama_ibu,
          nama_wali: form.nama_wali || null,
          no_hp_orangtua_wali: form.no_hp_orangtua_wali,
          anak_ke: form.anak_ke ? parseInt(form.anak_ke) : null,
          jumlah_saudara: form.jumlah_saudara ? parseInt(form.jumlah_saudara) : null,
        }),
      })
      const json = await res.json()
      if (json.error) { setError(json.error); return }

      if (user) {
        await logAudit(user, 'UPDATE', 'Data Generus', editTarget.users.nama_lengkap, {}, editTarget.users.id)
      }
      setEditTarget(null)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  // Export biodata lengkap -- dipindah dari menu "Pengguna" ke sini karena di halaman
  // inilah biodata (TTL, kelas ngaji, data ortu, dll) benar-benar tersedia dan bisa dijamin
  // terisi. Hanya utk yang boleh mengelola (canManage), sama seperti tombol edit.
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
      kelas_ngaji: g.kelas_ngaji ? (kelasNgajiLabel[g.kelas_ngaji] || g.kelas_ngaji) : '-',
      alamat: g.alamat || '-',
      nama_ayah: g.nama_ayah || '-',
      nama_ibu: g.nama_ibu || '-',
      hp_ortu: g.no_hp_orangtua_wali || '-',
      desa: g.users?.desa?.nama_desa || '-',
      kelompok: g.users?.kelompok?.nama_kelompok || '-',
    }
  })

  const exportSubtitle = () => {
    const t = user?.role?.tingkatan
    const scope = t === 'kelompok' ? user?.kelompok_id && data[0]?.users?.kelompok?.nama_kelompok
      : t === 'desa' ? user?.desa_id && data[0]?.users?.desa?.nama_desa
      : 'Se-Bekasi Timur'
    return `${scope || 'Se-Bekasi Timur'} -- ${filtered.length} Generus`
  }

  const handleExportPDF = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      exportToPDF({
        title: 'Data Generus (Biodata)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Data-Generus-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Generus', `PDF -- ${filtered.length} generus`)
    } finally {
      setExporting(false)
    }
  }

  const handleExportExcel = async () => {
    if (filtered.length === 0) { alert('Tidak ada data untuk diexport.'); return }
    setExporting(true)
    try {
      await exportToExcel({
        title: 'Data Generus (Biodata)',
        subtitle: exportSubtitle(),
        columns: exportColumns,
        rows: buildExportData(),
        fileName: `Data-Generus-${new Date().toISOString().slice(0, 10)}`,
      })
      if (user) await logAudit(user, 'EXPORT', 'Data Generus', `Excel -- ${filtered.length} generus`)
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

  // Blokir akses Generus biasa -- biodata sensitif hanya utk Pengurus/PPG/Super Admin.
  if (!hasAccess) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🔒</div>
        <p className="font-semibold text-slate-600">Akses Dibatasi</p>
        <p className="text-sm mt-1">Menu Data Generus hanya tersedia untuk Pengurus dan PPG.</p>
      </div>
    )
  }

  // Lapisan kedua setelah sidebar -- kalau Super Admin mematikan menu ini utk jenjang role
  // user ini lewat Pengaturan Fitur, akses langsung via URL juga diblok di sini.
  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Data Generus saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Data Generus</h2>
          <p className="text-slate-400 text-sm">Biodata pribadi {data.length} Generus -- terpisah dari data akun/login (menu Pengguna)</p>
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

      <input type="text" placeholder="Cari nama, no. generus, desa, kelompok..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🗂️</div>
          <p>Belum ada data Generus</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Generus</th>
                  <th className="px-4 py-3 font-medium">No. Generus</th>
                  <th className="px-4 py-3 font-medium">Desa / Kelompok</th>
                  <th className="px-4 py-3 font-medium">Jenis Kelamin</th>
                  {/* Usia dihitung otomatis dari tanggal_lahir, bukan kolom database --
                      lihat lib/date.ts. Selalu akurat, bertambah sendiri tiap tahun. */}
                  <th className="px-4 py-3 font-medium">Usia</th>
                  <th className="px-4 py-3 font-medium">Kelengkapan</th>
                  {canManage && <th className="px-4 py-3 font-medium">Aksi</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(g => {
                  const lengkap = !!(g.tempat_lahir && g.tanggal_lahir && g.jenis_kelamin && g.alamat && g.nama_ayah && g.nama_ibu)
                  return (
                    <tr key={g.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm shrink-0">
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
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${lengkap ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                          {lengkap ? 'Lengkap' : 'Belum Lengkap'}
                        </span>
                      </td>
                      {canManage && (
                        <td className="px-4 py-3">
                          <button onClick={() => openEdit(g)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">
                            Lihat / Edit
                          </button>
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
              <span className="text-xs text-slate-400">No. Generus</span>
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Jenis Kelamin *</label>
                  <select value={form.jenis_kelamin} onChange={e => set('jenis_kelamin', e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                    <option value="">-- Pilih --</option>
                    {/* value HARUS lowercase -- kolom generus.jenis_kelamin dibatasi CHECK
                        constraint anggota_jenis_kelamin_check (hanya 'laki-laki'/'perempuan').
                        Value uppercase sebelumnya membuat setiap update GAGAL DIAM-DIAM (server
                        cuma console.error, tidak pernah melapor balik ke user) -- bug ini
                        ditemukan dari kasus nyata: 2 akun sudah beberapa kali "berhasil" disimpan
                        di UI/audit log tapi datanya tidak pernah benar-benar tersimpan. */}
                    <option value="laki-laki">LAKI-LAKI</option>
                    <option value="perempuan">PEREMPUAN</option>
                  </select>
                </div>
                {editTarget.users?.roles?.tingkatan !== 'ppg' && (
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Kelas Ngaji *</label>
                    <select value={form.kelas_ngaji} onChange={e => set('kelas_ngaji', e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60">
                      <option value="">-- Pilih --</option>
                      <option value="pra_remaja">{kelasNgajiLabel.pra_remaja}</option>
                      <option value="remaja_muda">{kelasNgajiLabel.remaja_muda}</option>
                      <option value="remaja_dewasa">{kelasNgajiLabel.remaja_dewasa}</option>
                    </select>
                  </div>
                )}
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Anak Ke-</label>
                  <input type="number" min="1" max="20" value={form.anak_ke} onChange={e => set('anak_ke', e.target.value)}
                    placeholder="1"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Dari ... Bersaudara</label>
                  <input type="number" min="1" max="20" value={form.jumlah_saudara} onChange={e => set('jumlah_saudara', e.target.value)}
                    placeholder="3"
                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
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
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Ibu Kandung * (huruf kapital)</label>
                    <input value={form.nama_ibu}
                      onChange={e => setUpper('nama_ibu', e.target.value)}
                      placeholder="NAMA IBU"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Nama Wali (jika ada, huruf kapital)</label>
                    <input value={form.nama_wali}
                      onChange={e => setUpper('nama_wali', e.target.value)}
                      placeholder="NAMA WALI (opsional)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 uppercase disabled:opacity-60" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">No. HP Orang Tua *</label>
                    <input value={form.no_hp_orangtua_wali} onChange={e => set('no_hp_orangtua_wali', e.target.value)}
                      placeholder="08xx-xxxx-xxxx"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60" />
                  </div>
                </div>
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
    </div>
  )
}
