'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Kegiatan, Pengumuman } from '@/lib/types'
import { isPPG } from '@/lib/roles'
import Modal from '@/components/Modal'

type ApprovalTarget =
  | { type: 'kegiatan'; item: Kegiatan }
  | { type: 'pengumuman'; item: Pengumuman }

// Dashboard PPG (Penggerak Pembina Generus) -- read-only lintas Desa/Kelompok se-Daerah
// Bekasi Timur, plus kewenangan approval kegiatan/pengumuman tingkat Daerah sebelum tayang.
export default function PPGPage() {
  const { user } = useUser()
  const router = useRouter()
  const isPPGUser = isPPG(user)

  const [loading, setLoading] = useState(true)
  const [menunggu, setMenunggu] = useState<{ kegiatan: Kegiatan[]; pengumuman: Pengumuman[] }>({ kegiatan: [], pengumuman: [] })
  const [ringkasan, setRingkasan] = useState({ totalAnggota: 0, kegiatanAktif: 0, pengumumanAktif: 0, totalDesa: 0, totalKelompok: 0 })
  const [approvalTarget, setApprovalTarget] = useState<ApprovalTarget | null>(null)
  const [catatan, setCatatan] = useState('')
  const [processing, setProcessing] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const loadData = useCallback(async () => {
    setLoading(true)
    const [
      { data: kegiatanMenunggu },
      { data: pengumumanMenunggu },
      { count: totalAnggota },
      { count: kegiatanAktif },
      { count: pengumumanAktif },
      { count: totalDesa },
      { count: totalKelompok },
    ] = await Promise.all([
      supabase.from('kegiatan').select('*').eq('tingkatan', 'daerah').eq('status_approval', 'menunggu_ppg').order('created_at', { ascending: false }),
      supabase.from('pengumuman').select('*').eq('tingkatan', 'daerah').eq('status_approval', 'menunggu_ppg').order('created_at', { ascending: false }),
      supabase.from('anggota').select('id', { count: 'exact', head: true }).eq('status', 'aktif'),
      supabase.from('kegiatan').select('id', { count: 'exact', head: true }).in('status', ['upcoming', 'ongoing']),
      supabase.from('pengumuman').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('desa').select('id', { count: 'exact', head: true }).eq('is_active', true),
      supabase.from('kelompok').select('id', { count: 'exact', head: true }).eq('is_active', true),
    ])

    setMenunggu({ kegiatan: kegiatanMenunggu || [], pengumuman: pengumumanMenunggu || [] })
    setRingkasan({
      totalAnggota: totalAnggota || 0,
      kegiatanAktif: kegiatanAktif || 0,
      pengumumanAktif: pengumumanAktif || 0,
      totalDesa: totalDesa || 0,
      totalKelompok: totalKelompok || 0,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    if (!isPPGUser) {
      router.replace('/dashboard')
      return
    }
    loadData()
  }, [user, isPPGUser, router, loadData])

  const openApprove = (target: ApprovalTarget) => {
    setApprovalTarget(target)
    setCatatan('')
    setErrorMsg(null)
  }

  const submitApproval = async (aksi: 'setujui' | 'tolak') => {
    if (!approvalTarget) return
    if (aksi === 'tolak' && !catatan.trim()) {
      setErrorMsg('Catatan alasan penolakan wajib diisi.')
      return
    }
    setProcessing(true)
    setErrorMsg(null)
    try {
      const fn = approvalTarget.type === 'kegiatan'
        ? (aksi === 'setujui' ? 'approve_kegiatan' : 'reject_kegiatan')
        : (aksi === 'setujui' ? 'approve_pengumuman' : 'reject_pengumuman')
      const paramKey = approvalTarget.type === 'kegiatan' ? 'p_kegiatan_id' : 'p_pengumuman_id'
      const { error } = await supabase.rpc(fn, { [paramKey]: approvalTarget.item.id, p_catatan: catatan.trim() || null })
      if (error) throw error
      setApprovalTarget(null)
      loadData()
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Gagal memproses persetujuan.')
    } finally {
      setProcessing(false)
    }
  }

  if (!isPPGUser) return null

  const fmt = (t: string | null) => t ? new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : '-'

  const summaryCards = [
    { label: 'Total Ru\'yah Aktif', value: ringkasan.totalAnggota, icon: '👥', color: 'bg-blue-500' },
    { label: 'Kegiatan Berjalan', value: ringkasan.kegiatanAktif, icon: '📅', color: 'bg-indigo-500' },
    { label: 'Pengumuman Aktif', value: ringkasan.pengumumanAktif, icon: '📢', color: 'bg-orange-500' },
    { label: 'Desa & Kelompok', value: `${ringkasan.totalDesa} / ${ringkasan.totalKelompok}`, icon: '🏘️', color: 'bg-emerald-500' },
  ]

  const totalMenunggu = menunggu.kegiatan.length + menunggu.pengumuman.length

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="bg-gradient-to-r from-purple-700 to-indigo-700 rounded-2xl p-5 sm:p-6 text-white">
        <p className="text-purple-100 text-sm font-medium">Dashboard Pengawasan</p>
        <h2 className="text-xl sm:text-2xl font-bold mt-0.5">PPG Bekasi Timur</h2>
        <p className="text-purple-200 text-sm mt-1">Mengawasi, membina, dan mengontrol seluruh Kegiatan Muda-Mudi se-Daerah Bekasi Timur</p>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        {summaryCards.map(card => (
          <div key={card.label} className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
            <div className={`w-10 h-10 ${card.color} rounded-xl flex items-center justify-center text-xl mb-3`}>{card.icon}</div>
            <div className="text-lg sm:text-xl font-bold text-slate-800">{loading ? '...' : card.value}</div>
            <div className="text-slate-700 text-sm font-medium mt-0.5 leading-tight">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl p-4 sm:p-5 shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-slate-700">Menunggu Persetujuan</h3>
          {totalMenunggu > 0 && (
            <span className="px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">{totalMenunggu} item</span>
          )}
        </div>

        {loading ? (
          <div className="text-center py-8 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : totalMenunggu === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <div className="text-3xl mb-2">✓</div>
            <p className="text-sm">Tidak ada yang menunggu persetujuan saat ini</p>
          </div>
        ) : (
          <div className="space-y-3">
            {menunggu.kegiatan.map(k => (
              <div key={k.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 rounded-full text-xs font-medium">Kegiatan</span>
                    <p className="font-medium text-slate-700 text-sm truncate">{k.nama_kegiatan}</p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">{fmt(k.tanggal_mulai)} · {k.lokasi}</p>
                </div>
                <button onClick={() => openApprove({ type: 'kegiatan', item: k })}
                  className="shrink-0 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition">
                  Tinjau
                </button>
              </div>
            ))}
            {menunggu.pengumuman.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-slate-100">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full text-xs font-medium">Pengumuman</span>
                    <p className="font-medium text-slate-700 text-sm truncate">{p.judul}</p>
                  </div>
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">{p.isi}</p>
                </div>
                <button onClick={() => openApprove({ type: 'pengumuman', item: p })}
                  className="shrink-0 px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 transition">
                  Tinjau
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal open={!!approvalTarget} onClose={() => setApprovalTarget(null)} title="Tinjau & Setujui" size="md">
        {approvalTarget && (
          <div className="space-y-4">
            <div>
              <p className="font-semibold text-slate-800">
                {approvalTarget.type === 'kegiatan' ? approvalTarget.item.nama_kegiatan : approvalTarget.item.judul}
              </p>
              <p className="text-sm text-slate-500 mt-1 whitespace-pre-line">
                {approvalTarget.type === 'kegiatan' ? approvalTarget.item.deskripsi : approvalTarget.item.isi}
              </p>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Catatan (wajib jika menolak)</label>
              <textarea value={catatan} onChange={e => setCatatan(e.target.value)}
                rows={3} placeholder="Tulis catatan pembinaan atau alasan penolakan..."
                className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-none" />
            </div>
            {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
            <div className="flex gap-3 pt-2 border-t border-slate-100">
              <button onClick={() => submitApproval('tolak')} disabled={processing}
                className="flex-1 py-2.5 border border-red-200 text-red-600 rounded-xl text-sm font-medium hover:bg-red-50 disabled:opacity-60 transition">
                {processing ? 'Memproses...' : 'Tolak'}
              </button>
              <button onClick={() => submitApproval('setujui')} disabled={processing}
                className="flex-1 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 disabled:bg-purple-300 transition">
                {processing ? 'Memproses...' : 'Setujui'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
