'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { isGenerusBiasa, canManageKontenOrganisasi } from '@/lib/roles'
import { useFeatureAccess } from '@/lib/feature-toggles'
import Modal from '@/components/Modal'

interface Dokumen {
  id: string
  judul: string
  deskripsi: string | null
  kategori: string | null
  url_file: string
  nama_file: string
  ukuran_file: number | null
  tipe_file: string | null
  is_public: boolean
  created_at: string
  desa_id: string | null
  kelompok_id: string | null
  desa: { nama_desa: string } | null
  kelompok: { nama_kelompok: string } | null
  uploader: { nama_lengkap: string } | null
  nomor_dokumen: string | null
}

const KATEGORI = ['Administrasi', 'Keuangan', 'Kegiatan', 'Pengumuman', 'Laporan', 'Lainnya']

const emptyForm = {
  judul: '',
  deskripsi: '',
  kategori: '',
  url_file: '',
  nama_file: '',
  is_public: true,
  desa_id: '',
  kelompok_id: '',
}

const iconFor = (tipe: string | null) => {
  if (!tipe) return '📄'
  if (tipe.includes('pdf')) return '📕'
  if (tipe.includes('word') || tipe.includes('document')) return '📘'
  if (tipe.includes('sheet') || tipe.includes('excel')) return '📗'
  if (tipe.includes('image')) return '🖼️'
  return '📄'
}

const formatSize = (bytes: number | null) => {
  if (!bytes) return ''
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

export default function DokumenPage() {
  const { user } = useUser()
  // Lapisan kedua setelah sidebar -- lihat catatan lengkap di kegiatan/page.tsx.
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'dokumen')
  const [data, setData] = useState<Dokumen[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKat, setFilterKat] = useState('')
  const [sortBy, setSortBy] = useState<'terbaru' | 'terlama' | 'judul_asc'>('terbaru')
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Dokumen | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [desaList, setDesaList] = useState<{ id: string; nama_desa: string }[]>([])
  const [kelompokList, setKelompokList] = useState<{ id: string; nama_kelompok: string; desa_id: string }[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    let query = supabase
      .from('dokumen')
      .select(`
        id, judul, deskripsi, kategori, url_file, nama_file, ukuran_file, tipe_file, is_public, created_at, nomor_dokumen,
        desa_id, kelompok_id,
        desa:desa_id(nama_desa),
        kelompok:kelompok_id(nama_kelompok),
        uploader:dibuat_oleh(nama_lengkap)
      `)
      .order('created_at', { ascending: false })

    const t = user?.role?.tingkatan
    // PPG melihat lintas Desa/Kelompok se-Bekasi Timur -- disejajarkan dengan super_admin/daerah,
    // bukan diam-diam lolos filter karena kelompok_id/desa_id-nya kebetulan NULL.
    if (t !== 'super_admin' && t !== 'daerah' && t !== 'ppg') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }

    // Generus biasa (role 'Generus') hanya boleh melihat dokumen yang ditandai publik —
    // dokumen internal/privat tetap tersembunyi dari mereka.
    if (isGenerusBiasa(user)) {
      query = query.eq('is_public', true)
    }

    const { data: rows, error: err } = await query
    if (err) { console.error('Gagal memuat data dokumen:', err.message) }
    setData((rows as unknown as Dokumen[]) || [])
    setLoading(false)
  }, [user])

  useEffect(() => {
    if (!user) return
    loadData()
    Promise.all([
      supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
      supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
    ]).then(([{ data: d }, { data: k }]) => {
      setDesaList(d || [])
      setKelompokList((k as unknown as { id: string; nama_kelompok: string; desa_id: string }[]) || [])
    })
  }, [user, loadData])

  const openAdd = () => {
    setEditTarget(null)
    setError('')
    setForm({ ...emptyForm, desa_id: user?.desa_id || '', kelompok_id: user?.kelompok_id || '' })
    setModalOpen(true)
  }

  const openEdit = (d: Dokumen) => {
    setEditTarget(d)
    setError('')
    setForm({
      judul: d.judul,
      deskripsi: d.deskripsi || '',
      kategori: d.kategori || '',
      url_file: d.url_file,
      nama_file: d.nama_file,
      is_public: d.is_public,
      desa_id: d.desa_id || '',
      kelompok_id: d.kelompok_id || '',
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    setError('')
    if (!form.judul) { setError('Judul dokumen wajib diisi'); return }
    if (!form.url_file) { setError('URL file wajib diisi'); return }
    if (!form.kategori) { setError('Kategori wajib dipilih'); return }
    if (!form.deskripsi) { setError('Deskripsi wajib diisi'); return }
    if (!form.desa_id) { setError('Desa wajib dipilih'); return }
    setSaving(true)
    const payload = {
      judul: form.judul,
      deskripsi: form.deskripsi,
      kategori: form.kategori,
      url_file: form.url_file,
      nama_file: form.nama_file || form.judul,
      is_public: form.is_public,
      desa_id: form.desa_id,
      kelompok_id: form.kelompok_id || null,
      dibuat_oleh: user?.id,
    }
    if (editTarget) {
      const { error: err } = await supabase.from('dokumen').update(payload).eq('id', editTarget.id)
      if (err) { setError(`Gagal menyimpan perubahan: ${err.message}`); setSaving(false); return }
      if (user) await logAudit(user, 'UPDATE', 'Dokumen', form.judul, payload, editTarget.id)
    } else {
      const { data: ins, error: err } = await supabase.from('dokumen').insert(payload).select('id').single()
      if (err) { setError(`Gagal membuat dokumen: ${err.message}`); setSaving(false); return }
      if (user) await logAudit(user, 'CREATE', 'Dokumen', form.judul, payload, ins?.id)
    }
    setSaving(false)
    setModalOpen(false)
    loadData()
  }

  const handleDelete = async (id: string, judul?: string) => {
    if (!confirm('Hapus dokumen ini?')) return
    const { error: err } = await supabase.from('dokumen').delete().eq('id', id)
    if (err) { alert(`Gagal menghapus dokumen: ${err.message}`); return }
    if (user) await logAudit(user, 'DELETE', 'Dokumen', judul || id, {}, id)
    loadData()
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))

  const filtered = data
    .filter(d => {
      const q = search.toLowerCase()
      const matchSearch = !search || d.judul?.toLowerCase().includes(q) || d.deskripsi?.toLowerCase().includes(q)
      const matchKat = !filterKat || d.kategori === filterKat
      return matchSearch && matchKat
    })
    .sort((a, b) => {
      if (sortBy === 'terbaru') return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      if (sortBy === 'terlama') return new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      if (sortBy === 'judul_asc') return a.judul.localeCompare(b.judul)
      return 0
    })

  // Ketua/Wakil Ketua di semua jenjang (termasuk Kelompok) boleh kelola dokumen. Super Admin
  // SENGAJA DIKECUALIKAN (sejak audit peran) -- read-only untuk konten operasional organisasi,
  // konsisten dengan Kegiatan/Pengumuman/Presensi.
  const canManage = canManageKontenOrganisasi(user)

  // Hanya Super Admin dan Daerah yang boleh memilih desa/kelompok manapun saat membuat dokumen.
  // Pengurus Desa/Kelompok dikunci ke scope-nya sendiri agar tidak submit ke luar wilayahnya —
  // RLS di database sudah menolak percobaan ini juga, tapi mengunci di UI mencegah error membingungkan.
  const canPickScope = ['super_admin', 'daerah'].includes(user?.role?.tingkatan || '')

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Dokumen saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Dokumen</h2>
          <p className="text-slate-400 text-sm">{data.length} dokumen tersimpan</p>
        </div>
        {canManage && (
          <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            + Tambah Dokumen
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <input type="text" placeholder="Cari judul atau deskripsi dokumen..."
          value={search} onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="terbaru">Terbaru</option>
          <option value="terlama">Terlama</option>
          <option value="judul_asc">Judul A–Z</option>
        </select>
        <select value={filterKat} onChange={e => setFilterKat(e.target.value)}
          className="px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm">
          <option value="">Semua Kategori</option>
          {KATEGORI.map(k => <option key={k} value={k}>{k}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📁</div>
          <p>Belum ada dokumen</p>
          {canManage && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Upload sekarang</button>}
        </div>
      ) : (
        <div className="grid gap-3">
          {filtered.map(d => (
            <div key={d.id} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100 flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center text-2xl shrink-0">
                {iconFor(d.tipe_file)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-slate-800">{d.judul}</h3>
                      {d.nomor_dokumen && (
                        <span className="px-1.5 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-400">{d.nomor_dokumen}</span>
                      )}
                    </div>
                    {d.deskripsi && <p className="text-slate-500 text-sm mt-0.5">{d.deskripsi}</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <a href={d.url_file} target="_blank" rel="noreferrer"
                      className="px-3 py-1.5 bg-blue-50 text-blue-600 text-xs font-medium rounded-lg hover:bg-blue-100 transition">
                      Buka
                    </a>
                    {canManage && (
                      <>
                        <button onClick={() => openEdit(d)} className="px-3 py-1.5 bg-slate-50 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-100 transition">Edit</button>
                        <button onClick={() => handleDelete(d.id, d.judul)} className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-medium rounded-lg hover:bg-red-100 transition">Hapus</button>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {d.kategori && (
                    <span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-xs rounded-full">{d.kategori}</span>
                  )}
                  {d.desa && <span className="text-slate-400 text-xs">{d.desa.nama_desa}</span>}
                  {d.kelompok && <span className="text-slate-400 text-xs">· {d.kelompok.nama_kelompok}</span>}
                  {d.ukuran_file && <span className="text-slate-400 text-xs">{formatSize(d.ukuran_file)}</span>}
                  <span className="text-slate-400 text-xs">{new Date(d.created_at).toLocaleDateString('id-ID')}</span>
                  {!d.is_public && <span className="px-1.5 py-0.5 bg-slate-100 text-slate-500 text-xs rounded">🔒 Privat</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Dokumen' : 'Tambah Dokumen'} size="md">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Judul Dokumen *</label>
            <input value={form.judul} onChange={e => set('judul', e.target.value)} placeholder="Judul dokumen"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">URL / Link File *</label>
            <input value={form.url_file} onChange={e => set('url_file', e.target.value)} placeholder="https://drive.google.com/..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-slate-400 mt-1">Paste link dari Google Drive, OneDrive, atau storage lainnya</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Nama File</label>
            <input value={form.nama_file} onChange={e => set('nama_file', e.target.value)} placeholder="contoh.pdf"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Kategori *</label>
            <select value={form.kategori} onChange={e => set('kategori', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">-- Pilih Kategori --</option>
              {KATEGORI.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Deskripsi *</label>
            <textarea value={form.deskripsi} onChange={e => set('deskripsi', e.target.value)} rows={2} placeholder="Keterangan singkat..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desa *</label>
              <select value={form.desa_id} onChange={e => { set('desa_id', e.target.value); set('kelompok_id', '') }}
                disabled={!canPickScope}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed">
                <option value="">-- Pilih Desa --</option>
                {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                disabled={!canPickScope && user?.role?.tingkatan === 'kelompok'}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Semua --</option>
                {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                  <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                ))}
              </select>
            </div>
          </div>

          {error && <p className="text-red-600 text-sm">{error}</p>}

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
    </div>
  )
}
