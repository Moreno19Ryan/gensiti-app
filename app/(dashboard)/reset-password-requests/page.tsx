'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { authFetch } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { ResetPasswordRequest } from '@/lib/types'
import Modal from '@/components/Modal'

const statusLabel: Record<string, { label: string; color: string }> = {
  pending: { label: 'Menunggu', color: 'bg-amber-100 text-amber-700' },
  processed: { label: 'Diproses', color: 'bg-green-100 text-green-700' },
  ditolak: { label: 'Ditolak', color: 'bg-red-100 text-red-600' },
}

// Halaman khusus Super Admin untuk memproses permintaan reset password yang masuk lewat
// halaman publik /lupa-password. Sengaja dibatasi hanya Super Admin (bukan Ketua/Wakil
// manapun) -- selaras dengan RLS reset_password_requests (reset_request_superadmin) dan
// endpoint /api/reset-password-requests yang memverifikasi tingkatan super_admin di server.
export default function ResetPasswordRequestsPage() {
  const { user } = useUser()
  const router = useRouter()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'

  const [data, setData] = useState<ResetPasswordRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [target, setTarget] = useState<ResetPasswordRequest | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch('/api/reset-password-requests')
      const json = await res.json()
      if (res.ok) setData(json.data || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!user) return
    if (!isSuperAdmin) { router.replace('/dashboard'); return }
    loadData()
  }, [user, isSuperAdmin, router, loadData])

  const openProcess = (r: ResetPasswordRequest) => {
    setTarget(r)
    setNewPassword('')
    setNotes('')
    setError('')
    setModalOpen(true)
  }

  const handleProcess = async () => {
    if (!target) return
    if (!newPassword || newPassword.length < 6) { setError('Password baru minimal 6 karakter'); return }
    setSaving(true)
    setError('')
    try {
      const res = await authFetch('/api/reset-password-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: target.id, action: 'process', newPassword, notes }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error || 'Gagal memproses permintaan'); return }
      if (user) await logAudit(user, 'UPDATE', 'ResetPassword', `Proses reset password -- ${target.email}`, undefined, String(target.id))
      setModalOpen(false)
      loadData()
    } finally {
      setSaving(false)
    }
  }

  const handleReject = async (r: ResetPasswordRequest) => {
    if (!confirm(`Tolak permintaan reset password dari ${r.nama} (${r.email})?`)) return
    try {
      const res = await authFetch('/api/reset-password-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: r.id, action: 'reject' }),
      })
      if (res.ok) {
        if (user) await logAudit(user, 'UPDATE', 'ResetPassword', `Tolak permintaan reset password -- ${r.email}`, undefined, String(r.id))
        loadData()
      }
    } catch {
      // diamkan -- daftar akan tetap menampilkan status lama, user bisa coba lagi
    }
  }

  if (!isSuperAdmin) return null

  const filtered = data.filter(r => filter === 'all' || r.status === filter)
  const pendingCount = data.filter(r => r.status === 'pending').length

  const fmt = (t: string) => new Date(t).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-bold text-slate-800">Permintaan Reset Password</h2>
          <p className="text-slate-400 text-sm">{pendingCount} permintaan menunggu diproses</p>
        </div>
        <div className="flex gap-1 bg-white border border-slate-100 p-1 rounded-xl shadow-sm w-fit">
          {(['pending', 'all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${filter === f ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {f === 'pending' ? 'Menunggu' : 'Semua'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="bg-white rounded-2xl p-12 text-center">
          <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔑</div>
          <p>{filter === 'pending' ? 'Tidak ada permintaan yang menunggu' : 'Belum ada permintaan reset password'}</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 font-medium">Nama</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Diajukan</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.nama}</td>
                  <td className="px-4 py-3 text-slate-500">{r.email}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{fmt(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusLabel[r.status]?.color}`}>
                      {statusLabel[r.status]?.label}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {r.status === 'pending' ? (
                      <div className="flex gap-3">
                        <button onClick={() => openProcess(r)} className="text-blue-600 hover:text-blue-800 text-xs font-medium">Proses</button>
                        <button onClick={() => handleReject(r)} className="text-red-400 hover:text-red-600 text-xs font-medium">Tolak</button>
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Proses Reset Password" size="sm">
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">{error}</div>}

          {target && (
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-sm">
              <p className="font-medium text-slate-800">{target.nama}</p>
              <p className="text-slate-500 text-xs">{target.email}</p>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Password Baru *</label>
            <input type="text" value={newPassword} onChange={e => setNewPassword(e.target.value)}
              placeholder="Min. 6 karakter"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-slate-400 mt-1">Password baru ini akan otomatis dikirim ke email pemilik akun setelah diproses.</p>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Catatan (opsional)</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-slate-50 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setModalOpen(false)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={handleProcess} disabled={saving}
              className="flex-1 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:bg-blue-300 transition flex items-center justify-center gap-2">
              {saving ? 'Memproses...' : 'Set Password Baru'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
