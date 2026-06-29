'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Pengumuman } from '@/lib/types'
import Modal from '@/components/Modal'
import { logAudit } from '@/lib/audit'

interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

const emptyForm = {
  judul: '',
  isi: '',
  tingkatan: 'semua',
  desa_id: '',
  kelompok_id: '',
  is_active: true,
}

export default function PengumumanPage() {
  const { user } = useUser()
  const [data, setData] = useState<Pengumuman[]>([])
  const [loading, setLoading] = useState(true)
  const [modalOpen, setModalOpen] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Pengumuman | null>(null)
  const [detailItem, setDetailItem] = useState<Pengumuman | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: rows } = await supabase
      .from('pengumuman')
      .select('*')
      .order('tanggal_publish', { ascending: false })
    setData(rows || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    loadData()
    Promise.all([
      supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
      supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
    ]).then(([{ data: d }, { data: k }]) => {
      setDesaList(d || [])
      setKelompokList(k || [])
    })
  }, [loadData])

  const canCreate = ['super_admin', 'daerah', 'desa'].includes(user?.role?.tingkatan || '')

  const openAdd = () => {
    setEditTarget(null)
    setForm({ ...emptyForm, desa_id: user?.desa_id || '' })
    setModalOpen(true)
  }

  const openEdit = (p: Pengumuman) => {
    setEditTarget(p)
    setForm({
      judul: p.judul,
      isi: p.isi,
      tingkatan: p.tingkatan || 'semua',
      desa_id: p.desa_id || '',
      kelompok_id: p.kelompok_id || '',
      is_active: p.is_active,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    if (!form.judul || !form.isi) return
    setSaving(true)
    try {
      const payload = {
        judul: form.judul,
        isi: form.isi,
        tingkatan: form.tingkatan || null,
        desa_id: form.desa_id || null,
        kelompok_id: form.kelompok_id || null,
        is_active: form.is_active,
        dibuat_oleh: user?.id,
        tanggal_publish: new Date().toISOString(),
      }
      if (editTarget) {
        await supabase.from('pengumuman').update(payload).eq('id', editTarget.id)
        if (user) await logAudit(user, 'UPDATE', 'Pengumuman', form.judul, payload, editTarget.id)
      } else {
        const { data: ins } = await supabase.from('pengumuman').insert(payload).select('id').single()
        if (user) await logAudit(user, 'CREATE', 'Pengumuman', form.judul, payload, ins?.id)
      }
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Hapus pengumuman ini?')) return
    await supabase.from('pengumuman').delete().eq('id', id)
    loadData()
  }

  const toggleActive = async (p: Pengumuman) => {
    await supabase.from('pengumuman').update({ is_active: !p.is_active }).eq('id', p.id)
    loadData()
  }

  const set = (key: string, val: string | boolean) => setForm(f => ({ ...f, [key]: val }))
  const fmt = (t: string) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })

  const tingkatanBadge: Record<string, string> = {
    semua: 'bg-blue-100 text-blue-700',
    daerah: 'bg-purple-100 text-purple-700',
    desa: 'bg-green-100 text-green-700',
    kelompok: 'bg-orange-100 text-orange-700',
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Pengumuman</h2>
          <p className="text-slate-400 text-sm">{data.filter(p => p.is_active).length} pengumuman aktif</p>
        </div>
        {canCreate && (
          <button onClick={openAdd} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
            + Buat Pengumuman
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📢</div>
          <p>Belum ada pengumuman</p>
          {canCreate && <button onClick={openAdd} className="mt-3 text-blue-600 text-sm font-medium hover:underline">+ Buat sekarang</button>}
        </div>
      ) : (
        <div className="space-y-3">
          {data.map(p => (
            <div key={p.id} className={`bg-white rounded-2xl p-5 shadow-sm border transition ${p.is_active ? 'border-slate-100 hover:shadow-md' : 'border-slate-100 opacity-60'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0 cursor-pointer" onClick={() => { setDetailItem(p); setDetailOpen(true) }}>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-slate-800">{p.judul}</h3>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${tingkatanBadge[p.tingkatan || 'semua']}`}>
                      {p.tingkatan || 'semua'}
                    </span>
                    {!p.is_active && <span className="px-2 py-0.5 bg-slate-100 text-slate-400 rounded-full text-xs">Nonaktif</span>}
                  </div>
                  <p className="text-slate-500 text-sm line-clamp-2">{p.isi}</p>
                  <p className="text-slate-400 text-xs mt-2">{fmt(p.tanggal_publish)}</p>
                </div>
                {canCreate && (
                  <div className="flex gap-2 shrink-0">
                    <button onClick={() => toggleActive(p)} className={`text-xs font-medium ${p.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                      {p.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                    </button>
                    <button onClick={() => openEdit(p)} className="text-blue-600 hover:text-blue-800 font-medium text-xs">Edit</button>
                    <button onClick={() => handleDelete(p.id)} className="text-red-400 hover:text-red-600 font-medium text-xs">Hapus</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail Modal */}
      <Modal open={detailOpen} onClose={() => setDetailOpen(false)} title={detailItem?.judul || ''} size="md">
        {detailItem && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${tingkatanBadge[detailItem.tingkatan || 'semua']}`}>
                {detailItem.tingkatan || 'semua'}
              </span>
              <span className="text-slate-400 text-xs">{fmt(detailItem.tanggal_publish)}</span>
            </div>
            <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">{detailItem.isi}</p>
          </div>
        )}
      </Modal>

      {/* Form Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editTarget ? 'Edit Pengumuman' : 'Buat Pengumuman'} size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Judul *</label>
            <input value={form.judul} onChange={e => set('judul', e.target.value)}
              placeholder="Judul pengumuman"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Isi Pengumuman *</label>
            <textarea value={form.isi} onChange={e => set('isi', e.target.value)}
              rows={5} placeholder="Tulis isi pengumuman di sini..."
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Target</label>
              <select value={form.tingkatan} onChange={e => set('tingkatan', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="semua">Semua</option>
                <option value="daerah">Daerah</option>
                <option value="desa">Desa</option>
                <option value="kelompok">Kelompok</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
              <select value={form.desa_id} onChange={e => set('desa_id', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Semua --</option>
                {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Kelompok</label>
              <select value={form.kelompok_id} onChange={e => set('kelompok_id', e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">-- Semua --</option>
                {kelompokList.filter(k => !form.desa_id || k.desa_id === form.desa_id).map(k => (
                  <option key={k.id} value={k.id}>{k.nama_kelompok}</option>
                ))}
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)}
              className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm text-slate-600">Aktifkan pengumuman</span>
          </label>

          <div className="flex gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Batal
            </button>
            <button onClick={handleSave} disabled={saving || !form.judul || !form.isi}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />Menyimpan...</> : 'Publikasikan'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
