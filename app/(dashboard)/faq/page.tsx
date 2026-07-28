'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import { useFeatureAccess } from '@/lib/feature-toggles'
import Modal from '@/components/Modal'
import { toast } from '@/lib/toast'
import { konfirmasi } from '@/lib/konfirmasi'
import { SkeletonCards } from '@/components/Skeleton'
import { Faq } from '@/lib/types'

const emptyForm = {
  pertanyaan: '',
  jawaban: '',
  kategori: '',
  urutan: 0,
  is_active: true,
}

// Halaman FAQ/Panduan -- accordion publik utk semua jenjang (termasuk Generus biasa, ini
// justru paling berguna buat mereka), dikelola Super Admin lewat tombol +Tambah/edit/hapus di
// halaman yang SAMA (bukan halaman admin terpisah -- konsisten dgn pola Dokumen/Pengumuman di
// app ini). Lihat ARCHITECTURE.md §13.
export default function FaqPage() {
  const { user } = useUser()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'faq')
  const [data, setData] = useState<Faq[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKategori, setFilterKategori] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Faq | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: rows, error: err } = await supabase
      .from('faq')
      .select('id, pertanyaan, jawaban, kategori, urutan, is_active, created_at, updated_at, updated_by')
      .order('urutan', { ascending: true })
      .order('created_at', { ascending: true })
    if (err) console.error('Gagal memuat FAQ:', err.message)
    setData(rows || [])
    setLoading(false)
  }, [])

  // Data-fetching on mount (bukan derived state) -- pola sama seperti halaman lain di app ini.
  useEffect(() => {
    if (!user) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [user, loadData])

  const openAdd = () => {
    setEditTarget(null)
    setError('')
    setForm(emptyForm)
    setModalOpen(true)
  }

  const openEdit = (f: Faq) => {
    setEditTarget(f)
    setError('')
    setForm({
      pertanyaan: f.pertanyaan,
      jawaban: f.jawaban,
      kategori: f.kategori || '',
      urutan: f.urutan,
      is_active: f.is_active,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    setError('')
    if (!form.pertanyaan.trim()) { setError('Pertanyaan wajib diisi'); return }
    if (!form.jawaban.trim()) { setError('Jawaban wajib diisi'); return }
    setSaving(true)
    const payload = {
      pertanyaan: form.pertanyaan.trim(),
      jawaban: form.jawaban.trim(),
      kategori: form.kategori.trim() || null,
      urutan: form.urutan,
      is_active: form.is_active,
      updated_at: new Date().toISOString(),
      updated_by: user?.id,
    }
    if (editTarget) {
      const { error: err } = await supabase.from('faq').update(payload).eq('id', editTarget.id)
      if (err) { setError(`Gagal menyimpan perubahan: ${err.message}`); setSaving(false); return }
      if (user) await logAudit(user, 'UPDATE', 'FAQ', form.pertanyaan, payload, editTarget.id)
    } else {
      const { data: ins, error: err } = await supabase.from('faq').insert(payload).select('id').single()
      if (err) { setError(`Gagal membuat FAQ: ${err.message}`); setSaving(false); return }
      if (user) await logAudit(user, 'CREATE', 'FAQ', form.pertanyaan, payload, ins?.id)
    }
    setSaving(false)
    setModalOpen(false)
    loadData()
  }

  const handleDelete = async (f: Faq) => {
    const setuju = await konfirmasi({
      judul: 'Hapus FAQ?',
      pesan: `Pertanyaan "${f.pertanyaan}" akan dihapus permanen dan tidak bisa dikembalikan.`,
      labelYa: 'Ya, Hapus',
      destruktif: true,
    })
    if (!setuju) return
    const { error: err } = await supabase.from('faq').delete().eq('id', f.id)
    if (err) { toast.gagal(`Gagal menghapus FAQ: ${err.message}`); return }
    if (user) await logAudit(user, 'DELETE', 'FAQ', f.pertanyaan, {}, f.id)
    toast.sukses('FAQ berhasil dihapus.')
    loadData()
  }

  const set = (key: keyof typeof form, val: string | number | boolean) => setForm(f => ({ ...f, [key]: val }))

  const kategoriUnik = Array.from(new Set(data.map(f => f.kategori).filter((k): k is string => !!k))).sort((a, b) => a.localeCompare(b))

  const filtered = data
    .filter(f => isSuperAdmin || f.is_active)
    .filter(f => {
      const q = search.trim().toLowerCase()
      const matchSearch = !q || f.pertanyaan.toLowerCase().includes(q) || f.jawaban.toLowerCase().includes(q)
      const matchKategori = !filterKategori || f.kategori === filterKategori
      return matchSearch && matchKategori
    })

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu FAQ/Panduan saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-500 to-cyan-600 flex items-center justify-center text-lg shrink-0">❓</div>
          <div>
            <h2 className="font-bold text-slate-800 dark:text-slate-100">FAQ / Panduan</h2>
            <p className="text-slate-400 text-xs">Pertanyaan yang sering ditanyakan seputar GENSITI</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button onClick={openAdd} className="shrink-0 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            + Tambah FAQ
          </button>
        )}
      </div>

      {!loading && data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Cari pertanyaan atau jawaban..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
          {kategoriUnik.length > 0 && (
            <select
              value={filterKategori}
              onChange={e => setFilterKategori(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
            >
              <option value="">Semua Kategori</option>
              {kategoriUnik.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
        </div>
      )}

      {loading ? (
        <SkeletonCards />
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">❓</div>
          <p>Belum ada FAQ</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔍</div>
          <p>Tidak ada FAQ yang cocok dengan pencarian/filter kamu</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(f => {
            const isOpen = expandedId === f.id
            return (
              <div key={f.id} className={`bg-white dark:bg-slate-800 rounded-2xl border ${isOpen ? 'border-blue-200 dark:border-blue-800' : 'border-slate-100 dark:border-slate-700'} shadow-sm overflow-hidden`}>
                <button
                  onClick={() => setExpandedId(isOpen ? null : f.id)}
                  className="w-full flex items-center justify-between gap-3 p-4 text-left"
                >
                  <div className="min-w-0 flex-1">
                    {!f.is_active && (
                      <span className="inline-block mb-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-200 text-slate-500 dark:bg-slate-700 dark:text-slate-400">Non-aktif (hanya kamu yang lihat)</span>
                    )}
                    {f.kategori && (
                      <span className="inline-block mb-1 ml-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400">{f.kategori}</span>
                    )}
                    <p className="font-semibold text-slate-800 dark:text-slate-100 text-sm">{f.pertanyaan}</p>
                  </div>
                  <span className={`shrink-0 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="px-4 pb-4">
                    <p className="text-slate-600 dark:text-slate-300 text-sm whitespace-pre-line">{f.jawaban}</p>
                    {isSuperAdmin && (
                      <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                        <button onClick={() => openEdit(f)} className="text-blue-600 dark:text-blue-400 text-xs font-semibold hover:underline">Edit</button>
                        <button onClick={() => handleDelete(f)} className="text-red-600 dark:text-red-400 text-xs font-semibold hover:underline">Hapus</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit FAQ' : 'Tambah FAQ'}>
        <div className="space-y-3">
          {error && <p className="text-red-600 text-sm bg-red-50 dark:bg-red-900/20 rounded-lg p-2.5">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Pertanyaan *</label>
            <input
              type="text"
              value={form.pertanyaan}
              onChange={e => set('pertanyaan', e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Jawaban *</label>
            <textarea
              value={form.jawaban}
              onChange={e => set('jawaban', e.target.value)}
              rows={5}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Kategori</label>
              <input
                type="text"
                list="faq-kategori-list"
                value={form.kategori}
                onChange={e => set('kategori', e.target.value)}
                placeholder="mis. Absensi"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <datalist id="faq-kategori-list">
                {kategoriUnik.map(k => <option key={k} value={k} />)}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Urutan</label>
              <input
                type="number"
                value={form.urutan}
                onChange={e => set('urutan', Number(e.target.value))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} className="rounded" />
            Tampilkan ke semua pengguna
          </label>
          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 rounded-xl text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving} className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {saving ? 'Menyimpan...' : 'Simpan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
