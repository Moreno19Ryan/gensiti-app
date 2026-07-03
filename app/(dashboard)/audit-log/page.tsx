'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AuditLog } from '@/lib/types'
import { canManageMembers } from '@/lib/roles'

export default function AuditLogPage() {
  const { user } = useUser()
  const router = useRouter()
  const [data, setData] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Filter tambahan -- per user, rentang tanggal, dan jenis aksi/modul. Opsi dropdown
  // (uniqueUsers/uniqueModules/uniqueActions di bawah) diturunkan dari nilai unik pada `data`
  // yang sudah dimuat, BUKAN hardcode daftar tetap -- supaya otomatis ikut berkembang kalau
  // ada modul/jenis aksi baru di masa depan tanpa perlu ubah kode ini.
  const [filterUser, setFilterUser] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  // Pakai helper terpusat lib/roles.ts (Ketua/Wakil semua jenjang + Super Admin) alih-alih
  // regex nama_role sendiri, agar konsisten dan tidak drift jika kriteria di roles.ts berubah.
  const isKvsOrAdmin = canManageMembers(user)

  const loadData = async () => {
    if (!user) return
    const t = user.role?.tingkatan

    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)

    // Scope filter: daerah/super admin lihat semua, desa filter by desa, kelompok filter by kelompok
    if (t === 'desa' && user.desa_id) {
      q = q.eq('desa_id', user.desa_id)
    } else if (t === 'kelompok' && user.kelompok_id) {
      q = q.eq('kelompok_id', user.kelompok_id)
    }
    // daerah & super_admin: no filter

    const { data: rows } = await q
    setData(rows || [])
    setLoading(false)
  }

  useEffect(() => {
    if (!user) return
    if (!isKvsOrAdmin) {
      router.replace('/dashboard')
      return
    }
    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  const uniqueUsers = Array.from(new Set(data.map(a => a.user_email).filter(Boolean))) as string[]
  const uniqueModules = Array.from(new Set(data.map(a => a.module).filter(Boolean))) as string[]
  const uniqueActions = Array.from(new Set(data.map(a => a.action).filter(Boolean))) as string[]

  const filtered = data.filter(a => {
    const matchSearch = !search ||
      a.action?.toLowerCase().includes(search.toLowerCase()) ||
      a.user_email?.toLowerCase().includes(search.toLowerCase()) ||
      a.module?.toLowerCase().includes(search.toLowerCase()) ||
      a.target_desc?.toLowerCase().includes(search.toLowerCase())
    const matchUser = !filterUser || a.user_email === filterUser
    const matchModule = !filterModule || a.module === filterModule
    const matchAction = !filterAction || a.action === filterAction
    const t = new Date(a.created_at).getTime()
    const matchFrom = !dateFrom || t >= new Date(dateFrom + 'T00:00:00').getTime()
    const matchTo = !dateTo || t <= new Date(dateTo + 'T23:59:59').getTime()
    return matchSearch && matchUser && matchModule && matchAction && matchFrom && matchTo
  })

  const hasActiveFilter = !!(filterUser || filterModule || filterAction || dateFrom || dateTo)
  const resetFilters = () => {
    setFilterUser(''); setFilterModule(''); setFilterAction(''); setDateFrom(''); setDateTo('')
  }

  const statusColor: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    warning: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Audit Log</h2>
        <p className="text-slate-400 text-sm">
          Rekam jejak aktivitas{user?.desa ? ` — ${user.desa.nama_desa}` : ''}{user?.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
        </p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100 space-y-2">
          <input
            type="text"
            placeholder="Cari aksi, user, modul, atau target..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex flex-wrap gap-2">
            <select value={filterUser} onChange={(e) => setFilterUser(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Semua User</option>
              {uniqueUsers.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select value={filterModule} onChange={(e) => setFilterModule(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Semua Modul</option>
              {uniqueModules.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)}
              className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Semua Aksi</option>
              {uniqueActions.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                title="Dari tanggal"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
              <span className="text-slate-300 text-xs">—</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                title="Sampai tanggal"
                className="px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {hasActiveFilter && (
              <button onClick={resetFilters}
                className="px-3 py-2 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition font-medium">
                Reset filter
              </button>
            )}
          </div>
          {hasActiveFilter && (
            <p className="text-xs text-slate-400">
              {filtered.length} dari {data.length} log ditampilkan
              {data.length >= 300 && ' (hanya menyaring 300 log terbaru -- gunakan rentang tanggal yang lebih baru kalau hasil tampak kosong)'}
            </p>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mr-2" />
            Memuat...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <div className="text-4xl mb-2">📋</div>
            <p>Belum ada log aktivitas</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                  <th className="px-4 py-3 font-medium">Waktu</th>
                  <th className="px-4 py-3 font-medium">User</th>
                  <th className="px-4 py-3 font-medium">Aksi</th>
                  <th className="px-4 py-3 font-medium">Modul</th>
                  <th className="px-4 py-3 font-medium">Target</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                      {new Date(a.created_at).toLocaleString('id-ID', {
                        day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{a.user_email || '-'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-800">{a.action}</td>
                    <td className="px-4 py-3 text-slate-600 text-xs">{a.module || '-'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{a.target_desc || a.target_id || '-'}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColor[a.status] || statusColor.success}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
