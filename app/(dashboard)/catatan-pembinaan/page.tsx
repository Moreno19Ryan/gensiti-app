'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { CatatanPembinaan } from '@/lib/types'
import { isPPG } from '@/lib/roles'

interface DesaOpt { id: string; nama_desa: string }
interface KelompokOpt { id: string; nama_kelompok: string; desa_id: string }

// Catatan Pembinaan: komunikasi satu arah dari PPG ke Pengurus (Daerah/Desa/Kelompok).
// - PPG: bisa menulis catatan baru, target Daerah (umum) / Desa tertentu / Kelompok tertentu.
// - Pengurus Daerah/Desa/Kelompok: hanya melihat catatan yang ditujukan utk scope mereka
//   (RLS di database yang menegakkan pemisahan ini, bukan filter client).
// - Super Admin: TIDAK relevan sama sekali (bukan pengurus, bukan PPG) -- redirect ke
//   dashboard kalau nekat akses lewat URL langsung, konsisten dengan proteksi RLS yang
//   sudah dicabut total untuk role ini di database.
export default function CatatanPembinaanPage() {
  const { user } = useUser()
  const router = useRouter()
  const isPPGUser = isPPG(user)
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  useEffect(() => {
    if (user && isSuperAdmin) router.replace('/dashboard')
  }, [user, isSuperAdmin, router])

  const [data, setData] = useState<CatatanPembinaan[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [desaList, setDesaList] = useState<DesaOpt[]>([])
  const [kelompokList, setKelompokList] = useState<KelompokOpt[]>([])

  const [form, setForm] = useState({ target: 'daerah', desa_id: '', kelompok_id: '', judul: '', isi: '' })

  const loadData = useCallback(async () => {
    setLoading(true)
    const { data: rows } = await supabase
      .from('catatan_pembinaan')
      .select('*, desa:target_desa_id(id, nama_desa), kelompok:target_kelompok_id(id, nama_kelompok)')
      .order('created_at', { ascending: false })
    setData((rows as CatatanPembinaan[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    loadData()
    if (isPPGUser) {
      Promise.all([
        supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
        supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
      ]).then(([{ data: d }, { data: k }]) => {
        setDesaList(d || [])
        setKelompokList(k || [])
      })
    }
  }, [user, isPPGUser, loadData])

  const openForm = () => {
    setForm({ target: 'daerah', desa_id: '', kelompok_id: '', judul: '', isi: '' })
    setErrorMsg(null)
    setFormOpen(true)
  }

  const handleSave = async () => {
    if (!form.judul.trim() || !form.isi.trim()) {
      setErrorMsg('Judul dan isi catatan wajib diisi.')
      return
    }
    if (form.target === 'desa' && !form.desa_id) {
      setErrorMsg('Pilih Desa tujuan.')
      return
    }
    if (form.target === 'kelompok' && !form.kelompok_id) {
      setErrorMsg('Pilih Kelompok tujuan.')
      return
    }
    setSaving(true)
    setErrorMsg(null)
    try {
      const { error } = await supabase.from('catatan_pembinaan').insert({
        dibuat_oleh: user?.id,
        target_desa_id: form.target === 'desa' ? form.desa_id : null,
        target_kelompok_id: form.target === 'kelompok' ? form.kelompok_id : null,
        judul: form.judul.trim(),
        isi: form.isi.trim(),
      })
      if (error) throw error
      setFormOpen(false)
      loadData()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Gagal menyimpan catatan.')
    } finally {
      setSaving(false)
    }
  }

  const fmt = (t: string) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  const targetLabel = (c: CatatanPembinaan) => {
    if (c.kelompok) return `Kelompok ${c.kelompok.nama_kelompok}`
    if (c.desa) return `Desa ${c.desa.nama_desa}`
    return 'Daerah (Umum)'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-bold text-slate-800">Catatan Pembinaan</h2>
          <p className="text-slate-400 text-sm">
            {isPPGUser ? 'Masukan dan evaluasi untuk pengurus KMM se-Bekasi Timur' : 'Masukan dan evaluasi dari PPG Bekasi Timur'}
          </p>
        </div>
        {isPPGUser && (
          <button onClick={openForm} className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition">
            + Tulis Catatan
          </button>
        )}
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        </div>
      ) : data.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📝</div>
          <p>Belum ada catatan pembinaan</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {data.map(c => (
            <div key={c.id} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">{targetLabel(c)}</span>
                <h3 className="font-semibold text-slate-800">{c.judul}</h3>
              </div>
              <p className="text-slate-600 text-sm whitespace-pre-line">{c.isi}</p>
              <p className="text-slate-400 text-xs mt-3">{fmt(c.created_at)}</p>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg space-y-4">
            <h3 className="font-bold text-slate-800 text-lg">Tulis Catatan Pembinaan</h3>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Tujuan</label>
              <select value={form.target} onChange={e => setForm(f => ({ ...f, target: e.target.value, desa_id: '', kelompok_id: '' }))}
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                <option value="daerah">Daerah (Umum)</option>
                <option value="desa">Desa tertentu</option>
                <option value="kelompok">Kelompok tertentu</option>
              </select>
            </div>

            {form.target === 'desa' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Pilih Desa *</label>
                <select value={form.desa_id} onChange={e => setForm(f => ({ ...f, desa_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="">-- Pilih Desa --</option>
                  {desaList.map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                </select>
              </div>
            )}

            {form.target === 'kelompok' && (
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Pilih Kelompok *</label>
                <select value={form.kelompok_id} onChange={e => setForm(f => ({ ...f, kelompok_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500">
                  <option value="">-- Pilih Kelompok --</option>
                  {kelompokList.map(k => <option key={k.id} value={k.id}>{k.nama_kelompok}</option>)}
                </select>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Judul *</label>
              <input value={form.judul} onChange={e => setForm(f => ({ ...f, judul: e.target.value }))}
                placeholder="Judul catatan"
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Isi Catatan *</label>
              <textarea value={form.isi} onChange={e => setForm(f => ({ ...f, isi: e.target.value }))}
                rows={4} placeholder="Tulis masukan atau evaluasi pembinaan..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
            </div>

            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}

            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button onClick={() => setFormOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
                Batal
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 disabled:bg-purple-300 transition">
                {saving ? 'Menyimpan...' : 'Kirim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
