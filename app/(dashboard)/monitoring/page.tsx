'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useUser } from '@/lib/user-context'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'
import Modal from '@/components/Modal'
import { AuditLog, EmailLog, EmailStatus } from '@/lib/types'
import { canManageMembers } from '@/lib/roles'

// Halaman "Monitoring & Log" -- gabungan 4 sumber observability yang sebelumnya terpisah
// (Kesehatan Sistem & Sesi Aktif dari menu "Administrasi Sistem", plus Audit Log dan Email
// Log yang masing-masing punya menu sendiri). Digabung supaya sidebar lebih ringkas, TAPI
// visibilitas tiap tab TETAP mengikuti aturan akses aslinya masing-masing -- BUKAN
// disamaratakan jadi satu gate akses per halaman:
// - Kesehatan Sistem & Sesi Aktif: SUPER ADMIN SAJA (murni administrasi teknis sistem)
// - Audit Log: super_admin, daerah, desa, kelompok (Ketua/Wakil/Sekretaris semua jenjang +
//   Super Admin, via canManageMembers) -- desa/kelompok terfilter scope, daerah/SA lihat semua
// - Email Log: super_admin, daerah SAJA (selaras RLS email_log_select_admin di database)
// Tab yang tidak diizinkan untuk role yang sedang login otomatis disembunyikan, dan halaman
// akan redirect ke /dashboard kalau user sama sekali tidak punya akses ke tab manapun.

type Tab = 'kesehatan' | 'audit' | 'email' | 'sesi'

const tingkatanColor: Record<string, string> = {
  super_admin: 'bg-red-100 text-red-700',
  daerah: 'bg-purple-100 text-purple-700',
  desa: 'bg-blue-100 text-blue-700',
  kelompok: 'bg-green-100 text-green-700',
  ppg: 'bg-amber-100 text-amber-700',
}

export default function MonitoringPage() {
  const { user } = useUser()
  const router = useRouter()
  const searchParams = useSearchParams()

  const tingkatan = user?.role?.tingkatan
  const isSuperAdmin = tingkatan === 'super_admin'
  const isDaerah = tingkatan === 'daerah'
  const canSeeAudit = canManageMembers(user)
  const canSeeEmail = isSuperAdmin || isDaerah

  const availableTabs = useMemo(() => {
    const tabs: { key: Tab; label: string }[] = []
    if (isSuperAdmin) tabs.push({ key: 'kesehatan', label: '💡 Kesehatan Sistem' })
    if (canSeeAudit) tabs.push({ key: 'audit', label: '📋 Audit Log' })
    if (canSeeEmail) tabs.push({ key: 'email', label: '✉️ Email Log' })
    if (isSuperAdmin) tabs.push({ key: 'sesi', label: '🔐 Sesi Aktif' })
    return tabs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuperAdmin, canSeeAudit, canSeeEmail])

  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    if (!user) return
    if (availableTabs.length === 0) { router.replace('/dashboard'); return }
    // Tab dari query string (?tab=email) untuk deep-link dari Dashboard -- hanya dipakai
    // sekali di awal kalau tabnya valid & tersedia untuk role ini, supaya link "Perlu
    // Perhatian" di dashboard bisa langsung membuka tab yang relevan.
    const fromQuery = searchParams.get('tab') as Tab | null
    setTab(prev => {
      if (prev && availableTabs.some(t => t.key === prev)) return prev
      if (fromQuery && availableTabs.some(t => t.key === fromQuery)) return fromQuery
      return availableTabs[0].key
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, availableTabs, router])

  if (!user || availableTabs.length === 0 || !tab) return null

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Monitoring & Log</h2>
        <p className="text-slate-400 text-sm">Pantau kesehatan sistem dan riwayat aktivitas</p>
      </div>

      {availableTabs.length > 1 && (
        <div className="flex gap-1 bg-white border border-slate-100 p-1 rounded-xl shadow-sm w-fit overflow-x-auto">
          {availableTabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition whitespace-nowrap ${tab === t.key ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'kesehatan' && isSuperAdmin && <KesehatanTab />}
      {tab === 'audit' && canSeeAudit && <AuditTab user={user} />}
      {tab === 'email' && canSeeEmail && <EmailTab />}
      {tab === 'sesi' && isSuperAdmin && <SesiTab user={user} />}
    </div>
  )
}

// ============================= TAB: KESEHATAN SISTEM (SA only) =============================

interface HealthStats {
  userByTingkatan: { tingkatan: string; label: string; count: number }[]
  totalUserAktif: number
  totalUserNonaktif: number
  emailSent: number
  emailFailed: number
  emailPending: number
  sesiAktifCount: number
}

function KesehatanTab() {
  const [stats, setStats] = useState<HealthStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: roleAgg }, { count: userAktif }, { count: userNonaktif }, { data: emailAgg }, { count: sesiAktif }] = await Promise.all([
        supabase.from('users').select('roles:role_id(tingkatan, nama_role)').eq('is_active', true),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('users').select('id', { count: 'exact', head: true }).eq('is_active', false),
        supabase.from('email_log').select('status'),
        supabase.from('users').select('id', { count: 'exact', head: true }).not('active_session_token', 'is', null).eq('is_active', true),
      ])

      const tingkatanLabel: Record<string, string> = { super_admin: 'Super Admin', daerah: 'Daerah', desa: 'Desa', kelompok: 'Kelompok', ppg: 'PPG' }
      const countMap = new Map<string, number>()
      ;(roleAgg as unknown as { roles: { tingkatan: string } | null }[] | null)?.forEach(row => {
        const t = row.roles?.tingkatan
        if (!t) return
        countMap.set(t, (countMap.get(t) || 0) + 1)
      })
      const userByTingkatan = Object.keys(tingkatanLabel).map(t => ({
        tingkatan: t,
        label: tingkatanLabel[t],
        count: countMap.get(t) || 0,
      }))

      const emailRows = emailAgg || []
      const emailSent = emailRows.filter(r => r.status === 'sent').length
      const emailFailed = emailRows.filter(r => r.status === 'failed').length
      const emailPending = emailRows.filter(r => r.status === 'pending').length

      setStats({
        userByTingkatan,
        totalUserAktif: userAktif || 0,
        totalUserNonaktif: userNonaktif || 0,
        emailSent,
        emailFailed,
        emailPending,
        sesiAktifCount: sesiAktif || 0,
      })
    } catch (err) {
      console.error('Gagal memuat kesehatan sistem:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading || !stats) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  const emailTotal = stats.emailSent + stats.emailFailed + stats.emailPending
  const emailErrorRate = emailTotal > 0 ? Math.round((stats.emailFailed / emailTotal) * 100) : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-blue-600">{stats.totalUserAktif}</div>
          <div className="text-slate-500 text-sm">Pengguna Aktif</div>
          <div className="text-slate-400 text-xs">{stats.totalUserNonaktif} nonaktif</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-emerald-600">{stats.sesiAktifCount}</div>
          <div className="text-slate-500 text-sm">Sesi Tersimpan</div>
          <div className="text-slate-400 text-xs">Belum logout -- beda dari &quot;Pengguna Online&quot; di Dashboard (itu real-time, ini token belum dikosongkan)</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className={`text-2xl font-black ${emailErrorRate > 10 ? 'text-red-600' : emailErrorRate > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{emailErrorRate}%</div>
          <div className="text-slate-500 text-sm">Error Rate Email</div>
          <div className="text-slate-400 text-xs">{stats.emailFailed} gagal dari {emailTotal}</div>
        </div>
        <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
          <div className="text-2xl font-black text-amber-600">{stats.emailPending}</div>
          <div className="text-slate-500 text-sm">Email Menunggu</div>
          <div className="text-slate-400 text-xs">status pending</div>
        </div>
      </div>

      <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
        <h3 className="font-semibold text-slate-700 mb-1">Distribusi Pengguna Aktif per Tingkatan</h3>
        <p className="text-slate-400 text-xs mb-4">Jumlah pengguna aktif dikelompokkan berdasarkan jenjang role</p>
        <div className="space-y-2">
          {stats.userByTingkatan.map(row => {
            const max = Math.max(...stats.userByTingkatan.map(r => r.count), 1)
            const pct = Math.round((row.count / max) * 100)
            return (
              <div key={row.tingkatan} className="flex items-center gap-3">
                <span className="w-24 text-xs text-slate-500 shrink-0">{row.label}</span>
                <div className="flex-1 h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${tingkatanColor[row.tingkatan]?.split(' ')[0].replace('100', '500') || 'bg-slate-400'}`} style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right text-xs font-semibold text-slate-700">{row.count}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
        💡 Indikator teknis murni (jumlah akun, status sesi, keberhasilan pengiriman email) -- bukan data organisasi atau keuangan, sesuai cakupan wewenang Super Admin sebagai pengelola sistem.
      </div>
    </div>
  )
}

// ============================= TAB: AUDIT LOG =============================

function AuditTab({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const [data, setData] = useState<AuditLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterUser, setFilterUser] = useState('')
  const [filterModule, setFilterModule] = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const loadData = useCallback(async () => {
    const t = user.role?.tingkatan
    let q = supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300)
    if (t === 'desa' && user.desa_id) {
      q = q.eq('desa_id', user.desa_id)
    } else if (t === 'kelompok' && user.kelompok_id) {
      q = q.eq('kelompok_id', user.kelompok_id)
    }
    const { data: rows } = await q
    setData(rows || [])
    setLoading(false)
  }, [user])

  useEffect(() => { loadData() }, [loadData])

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
    <div className="space-y-3">
      <p className="text-slate-400 text-xs">
        Rekam jejak aktivitas{user.desa ? ` — ${user.desa.nama_desa}` : ''}{user.kelompok ? ` · ${user.kelompok.nama_kelompok}` : ''}
      </p>

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

// ============================= TAB: EMAIL LOG =============================

const tipeLabel: Record<string, string> = {
  pengumuman: 'Pengumuman',
  kegiatan: 'Kegiatan',
  reminder: 'Reminder H-1',
  approval_ppg: 'Approval PPG',
}

const emailStatusColor: Record<EmailStatus, string> = {
  sent: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
  pending: 'bg-amber-100 text-amber-700',
}

const emailStatusLabel: Record<EmailStatus, string> = {
  sent: 'Terkirim',
  failed: 'Gagal',
  pending: 'Menunggu',
}

function EmailTab() {
  const [data, setData] = useState<EmailLog[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState<'' | EmailStatus>('')
  const [detailError, setDetailError] = useState<EmailLog | null>(null)

  const loadData = useCallback(async () => {
    const { data: rows, error } = await supabase
      .from('email_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) console.error('Email log load error:', error)
    setData(rows || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadData() }, [loadData])

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

  return (
    <div className="space-y-4">
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
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${emailStatusColor[e.status]}`}>
                        {emailStatusLabel[e.status]}
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

// ============================= TAB: SESI AKTIF (SA only) =============================

interface SessionRow {
  id: string
  nama_lengkap: string
  email: string
  login_username: string | null
  is_active: boolean
  active_session_created_at: string | null
  roles: { nama_role: string; tingkatan: string } | null
}

function SesiTab({ user }: { user: NonNullable<ReturnType<typeof useUser>['user']> }) {
  const [rows, setRows] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [confirmTarget, setConfirmTarget] = useState<SessionRow | null>(null)
  const [processing, setProcessing] = useState(false)

  const loadSessions = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('users')
      .select('id, nama_lengkap, email, login_username, is_active, active_session_created_at, roles:role_id(nama_role, tingkatan)')
      .not('active_session_token', 'is', null)
      .eq('is_active', true)
      .order('active_session_created_at', { ascending: false })
    if (error) console.error('Sesi load error:', error)
    setRows((data as unknown as SessionRow[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  const paksaLogout = async () => {
    if (!confirmTarget) return
    setProcessing(true)
    try {
      const { error } = await supabase
        .from('users')
        .update({ active_session_token: null })
        .eq('id', confirmTarget.id)
      if (error) { console.error('Gagal paksa logout:', error); return }
      await logAudit(user, 'UPDATE', 'Monitoring & Log - Sesi Aktif', `Paksa logout: ${confirmTarget.nama_lengkap}`, {}, confirmTarget.id)
      setConfirmTarget(null)
      loadSessions()
    } finally {
      setProcessing(false)
    }
  }

  const filtered = rows.filter(r => {
    const q = search.toLowerCase()
    return !search || r.nama_lengkap?.toLowerCase().includes(q) || r.email?.toLowerCase().includes(q) || r.login_username?.toLowerCase().includes(q)
  })

  return (
    <div className="space-y-3">
      <div className="p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
        💡 Daftar ini hanya menampilkan pengguna yang pernah login lewat form login sejak fitur sesi tunggal aktif. Paksa logout akan mengosongkan sesi tersebut -- pengguna otomatis keluar di perangkat manapun dalam waktu singkat, TANPA menonaktifkan akunnya.
      </div>

      <input type="text" placeholder="Cari nama, email, atau nama pengguna..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full px-4 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />

      {loading ? (
        <div className="bg-white rounded-2xl p-8 text-center">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔐</div>
          <p>Tidak ada sesi login aktif ditemukan</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100 bg-slate-50">
                <th className="px-4 py-3 font-medium">Pengguna</th>
                <th className="px-4 py-3 font-medium">Role</th>
                <th className="px-4 py-3 font-medium">Login Terakhir</th>
                <th className="px-4 py-3 font-medium">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800 flex items-center gap-2">
                      {r.nama_lengkap}
                      {r.id === user.id && (
                        <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-blue-100 text-blue-700">Sesi Anda</span>
                      )}
                    </div>
                    <div className="text-slate-400 text-xs">{r.login_username || r.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tingkatanColor[r.roles?.tingkatan || ''] || 'bg-slate-100 text-slate-500'}`}>
                      {r.roles?.nama_role || '-'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {r.active_session_created_at
                      ? new Date(r.active_session_created_at).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
                      : '-'}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setConfirmTarget(r)} className="text-red-500 hover:text-red-700 text-xs font-medium">
                      Paksa Logout
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!confirmTarget} onClose={() => setConfirmTarget(null)} title="Paksa Logout Sesi?" size="sm">
        <div className="space-y-4">
          {confirmTarget?.id === user.id ? (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
              ⚠️ Ini adalah sesi login Anda sendiri. Melanjutkan akan membuat Anda otomatis keluar dari sistem dalam waktu singkat dan harus login ulang.
            </div>
          ) : (
            <p className="text-sm text-slate-600">
              Sesi login <strong>{confirmTarget?.nama_lengkap}</strong> akan dikosongkan. Akunnya TIDAK dinonaktifkan -- yang bersangkutan bisa login kembali kapan saja lewat form login.
            </p>
          )}
          <div className="flex gap-3 pt-2 border-t border-slate-100">
            <button onClick={() => setConfirmTarget(null)} className="flex-1 py-2.5 border border-slate-200 text-slate-600 rounded-xl text-sm font-medium hover:bg-slate-50 transition">Batal</button>
            <button onClick={paksaLogout} disabled={processing}
              className="flex-1 py-2.5 bg-red-600 text-white rounded-xl text-sm font-medium hover:bg-red-700 disabled:bg-red-300 transition flex items-center justify-center gap-2">
              {processing ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : (confirmTarget?.id === user.id ? 'Ya, Logout Diri Sendiri' : 'Ya, Paksa Logout')}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
