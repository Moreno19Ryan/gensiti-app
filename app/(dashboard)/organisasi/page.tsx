'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import Modal from '@/components/Modal'

interface Desa {
  id: string
  nama_desa: string
  kode_desa: string | null
  alamat: string | null
  is_active: boolean
  created_at: string
  _count?: number
}

interface Kelompok {
  id: string
  nama_kelompok: string
  kode_kelompok: string | null
  desa_id: string | null
  is_active: boolean
  created_at: string
  desa: { nama_desa: string } | null
  _count?: number
}

export default function OrganisasiPage() {
  const { user } = useUser()
  const router = useRouter()
  const [tab, setTab] = useState<'desa' | 'kelompok'>('desa')

  // Desa state
  const [desaList, setDesaList] = useState<Desa[]>([])
  const [desaLoading, setDesaLoading] = useState(true)
  const [desaModal, setDesaModal] = useState(false)
  const [editDesa, setEditDesa] = useState<Desa | null>(null)
  const [desaForm, setDesaForm] = useState({ nama_desa: '', kode_desa: '', alamat: '', is_active: true })

  // Kelompok state
  const [kelompokList, setKelompokList] = useState<Kelompok[]>([])
  const [kelompokLoading, setKelompokLoading] = useState(true)
  const [kelompokModal, setKelompokModal] = useState(false)
  const [editKelompok, setEditKelompok] = useState<Kelompok | null>(null)
  const [kelompokForm, setKelompokForm] = useState({ nama_kelompok: '', kode_kelompok: '', desa_id: '', is_active: true })

  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadDesa = useCallback(async () => {
    setDesaLoading(true)
    const { data } = await supabase.from('desa').select('*').order('nama_desa')
    setDesaList((data as Desa[]) || [])
    setDesaLoading(false)
  }, [])

  const loadKelompok = useCallback(async () => {
    setKelompokLoading(true)
    const { data } = await supabase
      .from('kelompok')
      .select('*, desa:desa_id(nama_desa)')
      .order('nama_kelompok')
    setKelompokList((data as unknown as Kelompok[]) || [])
    setKelompokLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    if (user.role?.tingkatan !== 'super_admin') { router.replace('/dashboard'); return }
    loadDesa()
    loadKelompok()
  }, [user, router, loadDesa, loadKelompok])

  // --- DESA ---
  const openAddDesa = () => {
    setEditDesa(null)
    setError('')
    setDesaForm({ nama_desa: '', kode_desa: '', alamat: '', is_active: true })
    setDesaModal(true)
  }
  const openEditDesa = (d: Desa) => {
    setEditDesa(d)
    setError('')
    setDesaForm({ nama_desa: d.nama_desa, kode_desa: d.kode_desa || '', alamat: d.alamat || '', is_active: d.is_active })
    setDesaModal(true)
  }
  const saveDesa = async () => {
    setError('')
    if (!desaForm.nama_desa) { setError('Nama desa wajib diisi'); return }
    setSaving(true)
    const payload = { nama_desa: desaForm.nama_desa, kode_desa: desaForm.kode_desa || null, alamat: desaForm.alamat || null, is_active: desaForm.is_active }
    if (editDesa) {
      await supabase.from('desa').update(payload).eq('id', editDesa.id)
    } else {
      await supabase.from('desa').insert(payload)
    }
    setSaving(false)
    setDesaModal(false)
    loadDesa()
  }
  const toggleDesa = async (d: Desa) => {
    await supabase.from('desa').update({ is_active: !d.is_active }).eq('id', d.id)
    loadDesa()
  }

  // --- KELOMPOK ---
  const openAddKelompok = () => {
    setEditKelompok(null)
    setError('')
    setKelompokForm({ nama_kelompok: '', kode_kelompok: '', desa_id: '', is_active: true })
    setKelompokModal(true)
  }
  const openEditKelompok = (k: Kelompok) => {
    setEditKelompok(k)
    setError('')
    setKelompokForm({ nama_kelompok: k.nama_kelompok, kode_kelompok: k.kode_kelompok || '', desa_id: k.desa_id || '', is_active: k.is_active })
    setKelompokModal(true)
  }
  const saveKelompok = async () => {
    setError('')
    if (!kelompokForm.nama_kelompok) { setError('Nama kelompok wajib diisi'); return }
    setSaving(true)
    const payload = { nama_kelompok: kelompokForm.nama_kelompok, kode_kelompok: kelompokForm.kode_kelompok || null, desa_id: kelompokForm.desa_id || null, is_active: kelompokForm.is_active }
    if (editKelompok) {
      await supabase.from('kelompok').update(payload).eq('id', editKelompok.id)
    } else {
      await supabase.from('kelompok').insert(payload)
    }
    setSaving(false)
    setKelompokModal(false)
    loadKelompok()
  }
  const toggleKelompok = async (k: Kelompok) => {
    await supabase.from('kelompok').update({ is_active: !k.is_active }).eq('id', k.id)
    loadKelompok()
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Organisasi</h2>
        <p className="text-slate-400 text-sm">Kelola struktur Desa dan Kelompok</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-blue-600">{desaList.filter(d => d.is_active).length}</div>
          <div className="text-slate-500 text-sm">Desa Aktif</div>
          <div className="text-slate-400 text-xs">dari {desaList.length} total</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-green-600">{kelompokList.filter(k => k.is_active).length}</div>
          <div className="text-slate-500 text-sm">Kelompok Aktif</div>
          <div className="text-slate-400 text-xs">dari {kelompokList.length} total</div>
        </div>
      </div>

      {/* Tab */}
      <div className="flex gap-1 bg-white border border-slate-100 p-1 rounded-xl shadow-sm w-fit">
        {(['desa', 'kelompok'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition capitalize ${tab === t ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t === 'desa' ? '🏘️ Desa' : '👨‍👩‍👧‍👦 Kelompok'}
          </button>
        ))}
      </div>

      {/* === DESA TAB === */}
      {tab === 'desa' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddDesa} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Desa
            </button>
          </div>
          {desaLoading ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 font-medium">Nama Desa</th>
                    <th className="px-4 py-3 font-medium">Kode</th>
                    <th className="px-4 py-3 font-medium">Alamat</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {desaList.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Belum ada desa</td></tr>
                  ) : desaList.map(d => (
                    <tr key={d.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{d.nama_desa}</td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{d.kode_desa || '-'}</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{d.alamat || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${d.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                          {d.is_active ? 'Aktif' : 'Non-aktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => openEditDesa(d)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                          <button onClick={() => toggleDesa(d)} className={`text-xs font-medium ${d.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                            {d.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal open={desaModal} onClose={() => setDesaModal(false)} title={editDesa ? 'Edit Desa' : 'Tambah Desa'} size="sm">
            <div className="space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
              {editDesa?.kode_desa ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-400">Kode Desa</span>
                  <span className="font-mono text-sm font-semibold text-slate-600">{editDesa.kode_desa}</span>
                  <span className="text-xs text-slate-400 ml-auto">🔒 Auto-generate</span>
                </div>
              ) : !editDesa && (
                <div className="p-2 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-xs text-blue-500">Kode Desa (DSA-XXX) akan dibuat otomatis</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Desa *</label>
                <input value={desaForm.nama_desa} onChange={e => setDesaForm(f => ({ ...f, nama_desa: e.target.value }))}
                  placeholder="Nama desa"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Alamat</label>
                <textarea value={desaForm.alamat} onChange={e => setDesaForm(f => ({ ...f, alamat: e.target.value }))}
                  rows={2} placeholder="Alamat desa"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
              </div>
              {editDesa && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={desaForm.is_active} onChange={e => setDesaForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Desa aktif</span>
                </label>
              )}
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setDesaModal(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={saveDesa} disabled={saving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                  {saving ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : 'Simpan'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      )}

      {/* === KELOMPOK TAB === */}
      {tab === 'kelompok' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openAddKelompok} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition">
              + Tambah Kelompok
            </button>
          </div>
          {kelompokLoading ? (
            <div className="bg-white rounded-2xl p-8 text-center">
              <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                    <th className="px-4 py-3 font-medium">Nama Kelompok</th>
                    <th className="px-4 py-3 font-medium">Kode</th>
                    <th className="px-4 py-3 font-medium">Desa</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {kelompokList.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Belum ada kelompok</td></tr>
                  ) : kelompokList.map(k => (
                    <tr key={k.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                      <td className="px-4 py-3 font-medium text-slate-800">{k.nama_kelompok}</td>
                      <td className="px-4 py-3 font-mono text-slate-500 text-xs">{k.kode_kelompok || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 text-sm">{k.desa?.nama_desa || '-'}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${k.is_active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                          {k.is_active ? 'Aktif' : 'Non-aktif'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-3">
                          <button onClick={() => openEditKelompok(k)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Edit</button>
                          <button onClick={() => toggleKelompok(k)} className={`text-xs font-medium ${k.is_active ? 'text-slate-400 hover:text-slate-600' : 'text-green-600 hover:text-green-800'}`}>
                            {k.is_active ? 'Nonaktifkan' : 'Aktifkan'}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Modal open={kelompokModal} onClose={() => setKelompokModal(false)} title={editKelompok ? 'Edit Kelompok' : 'Tambah Kelompok'} size="sm">
            <div className="space-y-4">
              {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}
              {editKelompok?.kode_kelompok ? (
                <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-xl border border-slate-100">
                  <span className="text-xs text-slate-400">Kode Kelompok</span>
                  <span className="font-mono text-sm font-semibold text-slate-600">{editKelompok.kode_kelompok}</span>
                  <span className="text-xs text-slate-400 ml-auto">🔒 Auto-generate</span>
                </div>
              ) : !editKelompok && (
                <div className="p-2 bg-blue-50 rounded-xl border border-blue-100">
                  <span className="text-xs text-blue-500">Kode Kelompok (KLP-XXX) akan dibuat otomatis</span>
                </div>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Nama Kelompok *</label>
                <input value={kelompokForm.nama_kelompok} onChange={e => setKelompokForm(f => ({ ...f, nama_kelompok: e.target.value }))}
                  placeholder="Nama kelompok"
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Desa</label>
                <select value={kelompokForm.desa_id} onChange={e => setKelompokForm(f => ({ ...f, desa_id: e.target.value }))}
                  className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">-- Pilih Desa --</option>
                  {desaList.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.nama_desa}</option>)}
                </select>
              </div>
              {editKelompok && (
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={kelompokForm.is_active} onChange={e => setKelompokForm(f => ({ ...f, is_active: e.target.checked }))}
                    className="w-4 h-4 rounded accent-blue-600" />
                  <span className="text-sm text-slate-600">Kelompok aktif</span>
                </label>
              )}
              <div className="flex gap-3 pt-2 border-t border-slate-100">
                <button onClick={() => setKelompokModal(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
                <button onClick={saveKelompok} disabled={saving}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
                  {saving ? 'Menyimpan...' : 'Simpan'}
                </button>
              </div>
            </div>
          </Modal>
        </div>
      )}
    </div>
  )
}
