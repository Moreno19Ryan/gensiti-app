'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Absensi } from '@/lib/types'
import { isPPG } from '@/lib/roles'
import { logAudit } from '@/lib/audit'
import { exportToPDF, exportToExcel, ExportColumn } from '@/lib/export'
import ProfilHeader from '@/components/ProfilHeader'

// Sub-halaman "Riwayat Absensi" -- dipecah dari tab "Presensi" lama di
// app/(dashboard)/profil/page.tsx. Disembunyikan (redirect) utk Super Admin & PPG -- PPG
// tidak pernah check-in kegiatan sebagai peserta (dia pengawas), jadi query ini akan selalu
// kosong utk akunnya.
export default function RiwayatAbsensiPage() {
  const { user } = useUser()
  const router = useRouter()
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  const isPPGUser = isPPG(user)
  const blocked = isSuperAdmin || isPPGUser

  const [riwayatPresensi, setRiwayatPresensi] = useState<Absensi[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const loadRiwayatPresensi = useCallback(async (userId: string) => {
    setLoading(true)
    const { data: generus } = await supabase.from('generus').select('id').eq('user_id', userId).maybeSingle()
    if (!generus) {
      setRiwayatPresensi([])
      setLoading(false)
      return
    }
    const { data } = await supabase
      .from('absensi')
      .select('*, kegiatan:kegiatan_id(id, nama_kegiatan)')
      .eq('generus_id', generus.id)
      .order('waktu_absen', { ascending: false })
    setRiwayatPresensi((data as Absensi[]) || [])
    setLoading(false)
  }, [])

  useEffect(() => {
    if (!user) return
    if (blocked) { router.replace('/profil'); return }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRiwayatPresensi(user.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, blocked])

  if (!user || blocked) return null

  const badge: Record<string, string> = {
    hadir: 'bg-green-100 text-green-700',
    tidak_hadir: 'bg-red-100 text-red-600',
    izin: 'bg-amber-100 text-amber-700',
    sakit: 'bg-purple-100 text-purple-700',
  }
  const label: Record<string, string> = {
    hadir: 'Hadir', tidak_hadir: 'Tidak Hadir', izin: 'Izin', sakit: 'Sakit',
  }

  // Export riwayat pribadi -- pakai helper lib/export.ts yang sudah dipakai di modul lain
  // (Keuangan, Presensi, Generus, Kegiatan), dibatasi ke data yang SUDAH di-fetch & di-scope
  // ke user_id sendiri di loadRiwayatPresensi() di atas -- tidak ada query tambahan.
  const exportColumns: ExportColumn[] = [
    { header: 'Kegiatan', key: 'kegiatan', width: 32 },
    { header: 'Tanggal', key: 'tanggal', width: 20 },
    { header: 'Status', key: 'status', width: 14, isBadge: true },
  ]
  const buildExportRows = () => riwayatPresensi.map(r => ({
    kegiatan: r.kegiatan?.nama_kegiatan || 'Kegiatan',
    tanggal: r.waktu_absen
      ? new Date(r.waktu_absen).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
      : '-',
    status: r.status ? label[r.status] : '-',
  }))
  const handleExportPDF = async () => {
    if (riwayatPresensi.length === 0 || exporting) return
    setExporting(true)
    try {
      exportToPDF({
        title: 'Riwayat Absensi',
        subtitle: user.nama_lengkap,
        columns: exportColumns,
        rows: buildExportRows(),
        fileName: `Riwayat-Absensi-${new Date().toISOString().slice(0, 10)}`,
      })
      await logAudit(user, 'EXPORT', 'Riwayat Absensi', `PDF -- ${riwayatPresensi.length} baris`)
    } finally {
      setExporting(false)
    }
  }
  const handleExportExcel = async () => {
    if (riwayatPresensi.length === 0 || exporting) return
    setExporting(true)
    try {
      await exportToExcel({
        title: 'Riwayat Absensi',
        subtitle: user.nama_lengkap,
        columns: exportColumns,
        rows: buildExportRows(),
        fileName: `Riwayat-Absensi-${new Date().toISOString().slice(0, 10)}`,
      })
      await logAudit(user, 'EXPORT', 'Riwayat Absensi', `Excel -- ${riwayatPresensi.length} baris`)
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="max-w-lg mx-auto space-y-5">
      <ProfilHeader title="Riwayat Absensi" backHref="/profil" />

      <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 p-6">
        {!loading && riwayatPresensi.length > 0 && (
          <div className="flex justify-end gap-2 mb-4">
            <button onClick={handleExportPDF} disabled={exporting}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50">
              📄 PDF
            </button>
            <button onClick={handleExportExcel} disabled={exporting}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition disabled:opacity-50">
              📊 Excel
            </button>
          </div>
        )}
        {loading ? (
          <div className="text-center py-8 text-slate-400">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          </div>
        ) : riwayatPresensi.length === 0 ? (
          <div className="text-center py-8 text-slate-400">
            <p className="text-sm">Belum ada riwayat absensi</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700">
            {riwayatPresensi.map(r => (
              <div key={r.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{r.kegiatan?.nama_kegiatan || 'Kegiatan'}</p>
                  <p className="text-xs text-slate-400">{r.waktu_absen ? new Date(r.waktu_absen).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}</p>
                </div>
                {r.status && (
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${badge[r.status]}`}>{label[r.status]}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
