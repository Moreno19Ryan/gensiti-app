'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { EmailLog, EmailStatus } from '@/lib/types'

// Halaman Email Log: riwayat pengiriman email notifikasi (pengumuman, kegiatan, reminder H-1,
// approval PPG) via Resend, diambil dari tabel email_log yang sudah ada sejak awal tapi belum
// punya UI. Tujuannya murni observability sistem -- membantu Super Admin/Daerah mendiagnosis
// kenapa suatu notifikasi tidak sampai ke penerima, tanpa perlu masuk ke Supabase langsung.
// Akses: sama dengan RLS email_log_select_admin di database (super_admin + daerah), BUKAN
// modul konten organisasi -- jadi tidak lewat canManageKontenOrganisasi/canManageMembers,
// murni cek tingkatan seperti halaman Organisasi/Reset Password.
const tipeLabel: Record<string, string> = {
  pengumuman: 'Pengumuman',
  kegiatan: 'Kegiatan',
  reminder: 'Reminder H-1',
  approval_ppg: 'Approval PPG',
}

const statusColor: Record<EmailStatus, string> = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
}

const statusLabel: Record<EmailStatus, string> = {
  sent: 'Terkirim',
  failed: 'Gagal',
  pending: 'Menunggu',
}

export default function EmailLogPage() {
  const { user } = useUser()
  const router = useRouter()
  const [data, setData] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | EmailStatus>('')
  const [detailError, setDetailError] = useState<EmailLog | null>(null)

  const tingkatan = user?.role?.tingkatan
  const hasAccess = tingkatan === 'super_admin' || tingkatan === 'daerah'

  const loadData = async () => {
    const { data: rows, error } = await supabase
      .from('email_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) console.error('Email log load error:', error)
    setData(rows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    if (!hasAccess) {
      router.replace('/dashboard')
      return
    }
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const filtered = data.filter(e => {
    const q = search.toLowerCase()
    const matchSearch = !search ||
      e.recipient?.toLowerCase().includes(q) ||
      e.subject?.toLowerCase().includes(q)
    const matchStatus = !filterStatus || e.status === filterStatus
    return matchSearch && matchStatus
  })

  const summary = {
    total: data.length,
    sent: data.filter(e => e.status === 'sent').length,
    failed: data.filter(e => e.status === 'failed').length,
    pending: data.filter(e => e.status === 'pending').length,
  }

  if (user && !hasAccess) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Email Log</h2>
        <p className="text-slate-400 text-sm">Riwayat pengiriman email notifikasi sistem</p>
      </div>

      {/* Ringkasan cepat -- terutama supaya kegagalan kirim langsung terlihat tanpa harus
          menyaring 300 baris manual. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Total', value: summary.total, color: 'bg-slate-500' },
          { label: 'Terkirim', value: summary.sent, color: 'bg-green-500' },
          { label: 'Gagal', value: summary.failed, color: 'bg-red-500' },
          { label: 'Menunggu', value: summary.pending, color: 'bg-amber-500' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <div className={`w-8 h-8 rounded-lg ${s.color} flex items-center justify-center text-white text-sm mb-2`}>✉️</div>
            <p className="text-xl font-bold text-slate-800">{loading ? '...' : s.value}</p>
            <p className="text-xs text-slate-400">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Cari penerima atau subjek..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | EmailStatus)}
            className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Semua Status</option>
            <option value="sent">Terkirim</option>
            <option value="failed">Gagal</option>
            <option value="pending">Menunggu</option>
          </select>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
            Memuat...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">✉️</div>
            <p>Belum ada log email</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Waktu</th>
                  <th className="px-4 py-3 font-medium">Penerima</th>
                  <th className="px-4 py-3 font-medium">Subjek</th>
                  <th className="px-4 py-3 font-medium">Tipe</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr
                    key={e.id}
                    className={`border-b border-slate-50 hover:bg-slate-50 transition ${e.status === 'failed' ? 'cursor-pointer' : ''}`}
                    onClick={() => e.status === 'failed' && setDetailError(e)}
                  >
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString('id-ID', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{e.recipient}</td>
                    <td className="px-4 py-3 text-slate-700 text-xs max-w-xs truncate">{e.subject}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{tipeLabel[e.tipe] || e.tipe}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[e.status]}`}>
                        {statusLabel[e.status]}
                      </span>
                      {e.status === 'failed' && (
                        <span className="ml-2 text-xs text-blue-500 hover:underline">Lihat error</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Detail error -- ditampilkan sebagai panel sederhana, bukan Modal komponen, supaya
          tidak menambah dependency baru untuk kasus pemakaian yang ringan seperti ini. */}
      {detailError && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDetailError(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg space-y-3" onClick={e => e.stopPropagation()}>
            <h3 className="font-bold text-slate-800">Detail Kegagalan Kirim</h3>
            <div className="space-y-2 text-sm">
              <div>
                <p className="text-xs text-slate-400">Penerima</p>
                <p className="text-slate-700">{detailError.recipient}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Subjek</p>
                <p className="text-slate-700">{detailError.subject}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400">Pesan Error</p>
                <p className="text-red-600 font-mono text-xs bg-red-50 p-3 rounded-xl border border-red-100 break-words">
                  {detailError.error_message || 'Tidak ada detail error tercatat.'}
                </p>
              </div>
            </div>
            <button onClick={() => setDetailError(null)}
              className="w-full py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">
              Tutup
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
