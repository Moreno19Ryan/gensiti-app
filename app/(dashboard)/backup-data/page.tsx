'use client'

// Halaman Backup Data -- khusus Super Admin. Mengekspor seluruh data organisasi (bukan
// per-modul seperti export PDF/Excel yang lain) ke SATU file JSON gabungan, supaya bisa
// dipakai sebagai cadangan manual atau bahan migrasi/audit offline. JSON dipilih (bukan
// Excel) karena datanya relasional & terstruktur (nested objects, array, boolean, null) --
// Excel akan lossy untuk kasus ini. Tabel yang disertakan SENGAJA tidak termasuk audit_log
// & email_log (sudah punya viewer sendiri dgn tujuan observability, bukan data organisasi)
// maupun reset_password_requests (fitur retired, tabel dibiarkan ada utk histori) & tabel
// baru password_reset_otp (kode OTP sesaat/sensitif, tidak perlu dibackup).
//
// TIDAK ADA fitur restore/import di UI -- keputusan sengaja (dikonfirmasi audit peran
// 2026-07-16), BUKAN gap yang belum sempat dikerjakan. Restore itu operasi langka & berisiko
// tinggi (urutan insert harus ikut BACKUP_TABLES di atas krn dependency FK, berpotensi bentrok
// dengan data yang sudah ada, dan salah eksekusi bisa merusak seluruh database) -- sengaja
// dibiarkan sebagai proses MANUAL lewat SQL Editor Supabase kalau benar-benar darurat, bukan
// tombol self-service yang bisa diklik tanpa jeda berpikir. Lihat ARCHITECTURE.md § "Restore
// Data (Darurat)" untuk langkah manualnya.
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { logAudit } from '@/lib/audit'

// Urutan sengaja: tabel independen dulu (desa, kelompok, roles) baru yang bergantung FK ke
// mereka -- supaya kalau file ini dipakai untuk restore manual di masa depan, urutan insert
// tidak melanggar foreign key constraint.
const BACKUP_TABLES = [
  { key: 'desa', label: 'Desa' },
  { key: 'kelompok', label: 'Kelompok' },
  { key: 'roles', label: 'Roles' },
  { key: 'users', label: 'Pengguna' },
  { key: 'generus', label: 'Generus' },
  { key: 'kegiatan', label: 'Kegiatan' },
  { key: 'absensi', label: 'Absensi' },
  { key: 'pengumuman', label: 'Pengumuman' },
  { key: 'dokumen', label: 'Dokumen (metadata)' },
  { key: 'notifikasi', label: 'Notifikasi' },
] as const

// Tabel yang SENGAJA di luar wewenang Super Admin (keputusan desain dari audit peran
// sebelumnya -- Super Admin murni "pemegang kendali web/teknis", bukan pemilik data
// organisasi/keuangan). RLS memang memblokir SELECT untuk ketiganya dari sisi Super Admin,
// jadi tidak diambil sama sekali (bukan diambil lalu ternyata kosong) -- supaya laporan
// backup tidak menyesatkan seolah datanya memang tidak ada.
const EXCLUDED_TABLES = [
  { key: 'keuangan', label: 'Keuangan', reason: 'Di luar wewenang Super Admin (kebijakan: Super Admin tidak memiliki akses data keuangan organisasi)' },
  { key: 'catatan_pembinaan', label: 'Catatan Pembinaan', reason: 'Komunikasi tertutup PPG ↔ Pengurus, di luar wewenang Super Admin' },
  { key: 'email_preferensi', label: 'Preferensi Email', reason: 'Data preferensi pribadi tiap pengguna, hanya bisa dibaca oleh pemiliknya sendiri' },
] as const

interface TableStatus {
  key: string
  label: string
  status: 'pending' | 'loading' | 'done' | 'error'
  count?: number
  error?: string
}

export default function BackupDataPage() {
  const { user } = useUser()
  const router = useRouter()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<TableStatus[]>(
    BACKUP_TABLES.map(t => ({ key: t.key, label: t.label, status: 'pending' }))
  )
  const [lastBackup, setLastBackup] = useState<{ time: string; totalRows: number; fileName: string } | null>(null)

  useEffect(() => {
    if (!user) return
    if (user.role?.tingkatan !== 'super_admin') {
      router.replace('/dashboard')
    }
  }, [user, router])

  if (!user || user.role?.tingkatan !== 'super_admin') return null

  const runBackup = async () => {
    setRunning(true)
    setProgress(BACKUP_TABLES.map(t => ({ key: t.key, label: t.label, status: 'pending' })))
    BACKUP_TABLES.forEach(t => setProgress(prev => prev.map(p => p.key === t.key ? { ...p, status: 'loading' } : p)))

    // Dipanggil lewat /api/backup (service role di server) alih-alih query client-side
    // langsung -- supaya hasil backup tidak diam-diam terpotong kalau RLS salah satu dari
    // 10 tabel yang diizinkan berubah di masa depan. Lihat komentar di app/api/backup/route.ts.
    const result: Record<string, unknown[]> = {}
    let totalRows = 0
    let hadError = false

    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const accessToken = sessionData.session?.access_token
      const res = await fetch('/api/backup', {
        method: 'POST',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
      })
      const json = await res.json()

      if (!res.ok) {
        hadError = true
        setProgress(prev => prev.map(p => ({ ...p, status: 'error', error: json.error || 'Gagal memuat backup' })))
      } else {
        for (const table of BACKUP_TABLES) {
          const status = json.tableStatus?.[table.key]
          if (!status || status.error) {
            hadError = true
            setProgress(prev => prev.map(p => p.key === table.key ? { ...p, status: 'error', error: status?.error || 'Tidak ada data' } : p))
            result[table.key] = []
            continue
          }
          result[table.key] = json.data?.[table.key] || []
          totalRows += status.count || 0
          setProgress(prev => prev.map(p => p.key === table.key ? { ...p, status: 'done', count: status.count || 0 } : p))
        }
        if (json.hadError) hadError = true
      }
    } catch (err) {
      hadError = true
      const msg = err instanceof Error ? err.message : 'Gagal menghubungi server'
      setProgress(prev => prev.map(p => ({ ...p, status: 'error', error: msg })))
    }

    const now = new Date()
    const timestamp = now.toISOString().replace(/[:.]/g, '-')
    const fileName = `gensiti-backup-${timestamp}.json`

    const payload = {
      _meta: {
        app: 'GENSITI - Smart Organization Management System',
        generated_at: now.toISOString(),
        generated_by: user.email,
        total_rows: totalRows,
        tables: Object.fromEntries(Object.entries(result).map(([k, v]) => [k, v.length])),
        excluded_tables: Object.fromEntries(EXCLUDED_TABLES.map(t => [t.key, t.reason])),
        had_error: hadError,
      },
      data: result,
    }

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)

    setLastBackup({ time: now.toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'medium' }), totalRows, fileName })
    setRunning(false)

    await logAudit(
      user,
      'EXPORT',
      'Backup Data',
      `${fileName} -- ${totalRows} baris dari ${BACKUP_TABLES.length} tabel${hadError ? ' (ada error sebagian)' : ''}`,
      { tables: payload._meta.tables, had_error: hadError }
    )
  }

  const statusIcon = (s: TableStatus['status']) => {
    if (s === 'pending') return <span className="text-slate-300">○</span>
    if (s === 'loading') return <div className="w-3.5 h-3.5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    if (s === 'done') return <span className="text-green-500">✓</span>
    return <span className="text-red-500">✕</span>
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Backup Data</h2>
        <p className="text-slate-400 text-sm">Ekspor seluruh data organisasi ke satu file JSON untuk cadangan manual</p>
      </div>

      <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-5">
        <div className="flex items-start gap-3 mb-4 p-3 bg-amber-50 border border-amber-100 rounded-xl">
          <span className="text-xl shrink-0">⚠️</span>
          <p className="text-xs text-amber-700">
            File backup berisi seluruh data organisasi termasuk data pribadi pengguna (nama, email, no. HP, alamat).
            Simpan di tempat aman dan jangan dibagikan sembarangan. File ini tidak mengandung password akun
            (password dikelola terpisah oleh sistem autentikasi Supabase, tidak pernah tersimpan di tabel data).
          </p>
        </div>

        <button
          onClick={runBackup}
          disabled={running}
          className="w-full sm:w-auto px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {running ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              Membuat backup...
            </>
          ) : (
            <>💾 Backup Sekarang</>
          )}
        </button>

        {lastBackup && !running && (
          <p className="text-xs text-green-600 mt-3">
            ✓ Backup terakhir berhasil dibuat {lastBackup.time} -- {lastBackup.totalRows} baris total ({lastBackup.fileName})
          </p>
        )}

        <div className="mt-5 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500 mb-2">Tabel yang dicakup ({BACKUP_TABLES.length}):</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {progress.map(p => (
              <div key={p.key} className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-slate-50 text-xs">
                <span className="flex items-center gap-2 text-slate-600">
                  {statusIcon(p.status)}
                  {p.label}
                </span>
                {p.status === 'done' && <span className="text-slate-400">{p.count} baris</span>}
                {p.status === 'error' && <span className="text-red-500 truncate max-w-[120px]" title={p.error}>gagal</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4">
          <p className="text-xs font-medium text-slate-500 mb-2">Di luar cakupan ({EXCLUDED_TABLES.length}):</p>
          <div className="space-y-1.5">
            {EXCLUDED_TABLES.map(t => (
              <div key={t.key} className="flex items-start gap-2 px-3 py-1.5 rounded-lg bg-slate-50 text-xs">
                <span className="text-slate-300 shrink-0">○</span>
                <div>
                  <span className="text-slate-600 font-medium">{t.label}</span>
                  <span className="text-slate-400"> -- {t.reason}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
