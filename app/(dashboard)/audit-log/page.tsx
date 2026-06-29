'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { AuditLog } from '@/lib/types'

export default function AuditLogPage() {
  const { user } = useUser()
  const router = useRouter()
  const [data, setData] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    if (!user) return
    if (user.role?.tingkatan !== 'super_admin') {
      router.replace('/dashboard')
      return
    }
    loadData()
  }, [user])

  const loadData = async () => {
    const { data: rows } = await supabase
      .from('audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200)
    setData(rows || [])
    setLoading(false)
  }

  const filtered = data.filter(a =>
    a.action?.toLowerCase().includes(search.toLowerCase()) ||
    a.user_email?.toLowerCase().includes(search.toLowerCase()) ||
    a.module?.toLowerCase().includes(search.toLowerCase())
  )

  const statusColor: Record<string, string> = {
    success: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
    warning: 'bg-yellow-100 text-yellow-700',
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Audit Log</h2>
        <p className="text-slate-400 text-sm">Rekam jejak aktivitas sistem</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100">
        <div className="p-4 border-b border-slate-100">
          <input
            type="text"
            placeholder="Cari aksi, user, atau modul..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
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
