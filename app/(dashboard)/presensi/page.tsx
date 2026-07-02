'use client'

import { useEffect, useState, useCallback } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Kegiatan, Absensi } from '@/lib/types'
import { logAudit } from '@/lib/audit'
import { canManagePresensi } from '@/lib/roles'

const statusLabel: Record<string, { label: string; color: string }> = {
  upcoming: { label: 'Akan Datang', color: 'bg-blue-100 text-blue-700' },
  ongoing: { label: 'Berlangsung', color: 'bg-green-100 text-green-700' },
  selesai: { label: 'Selesai', color: 'bg-slate-100 text-slate-500' },
}

const kehadiranLabel: Record<string, { label: string; color: string }> = {
  hadir: { label: 'Hadir', color: 'bg-green-100 text-green-700' },
  tidak_hadir: { label: 'Tidak Hadir', color: 'bg-red-100 text-red-600' },
  izin: { label: 'Izin', color: 'bg-amber-100 text-amber-700' },
  sakit: { label: 'Sakit', color: 'bg-purple-100 text-purple-700' },
}

// Halaman koreksi manual presensi — hanya untuk Ketua/Wakil Ketua, Sekretaris & Super Admin
// (selaras dengan siapa yang boleh membuka sesi presensi di PresensiPanel).
// Alurnya: pilih kegiatan -> lihat semua anggota dalam scope kegiatan tsb beserta status
// kehadirannya -> bisa diedit manual kapan saja (mis. anggota lupa self check-in, atau ijin/sakit).
export default function PresensiPage() {
  const { user } = useUser()
  const canManage = canManagePresensi(user)

  const [kegiatanList, setKegiatanList] = useState<Kegiatan[]>([])
  const [selectedKegiatan, setSelectedKegiatan] = useState<Kegiatan | null>(null)
  const [loadingKegiatan, setLoadingKegiatan] = useState(true)
  const [search, setSearch] = useState('')

  const [anggotaScope, setAnggotaScope] = useState<{ id: string; nama_lengkap: string; nomor_anggota: string }[]>([])
  const [absensiMap, setAbsensiMap] = useState<Record<string, Absensi>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)

  const loadKegiatan = useCallback(async () => {
    setLoadingKegiatan(true)
    let query = supabase.from('kegiatan').select('*').order('tanggal_mulai', { ascending: false })
    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    const { data } = await query
    setKegiatanList(data || [])
    setLoadingKegiatan(false)
  }, [user])

  useEffect(() => {
    if (user && canManage) loadKegiatan()
  }, [user, canManage, loadKegiatan])

  const loadDetail = useCallback(async (kegiatan: Kegiatan) => {
    setLoadingDetail(true)
    setSelectedKegiatan(kegiatan)

    // Anggota dalam scope kegiatan (mengikuti tempat sambung TERKINI, bukan snapshot historis)
    let anggotaQuery = supabase.from('anggota').select('id, nama_lengkap, nomor_anggota').eq('status', 'aktif')
    if (kegiatan.tingkatan === 'kelompok' && kegiatan.kelompok_id) {
      anggotaQuery = anggotaQuery.eq('kelompok_id', kegiatan.kelompok_id)
    } else if (kegiatan.tingkatan === 'desa' && kegiatan.desa_id) {
      anggotaQuery = anggotaQuery.eq('desa_id', kegiatan.desa_id)
    } else if (kegiatan.desa_id) {
      anggotaQuery = anggotaQuery.eq('desa_id', kegiatan.desa_id)
    } else if (kegiatan.kelompok_id) {
      anggotaQuery = anggotaQuery.eq('kelompok_id', kegiatan.kelompok_id)
    }
    // tingkatan 'daerah' tanpa desa_id/kelompok_id -> seluruh anggota daerah (tidak difilter tambahan)

    const [{ data: anggotaRows }, { data: absensiRows }] = await Promise.all([
      anggotaQuery.order('nama_lengkap'),
      supabase.from('absensi').select('*').eq('kegiatan_id', kegiatan.id),
    ])

    setAnggotaScope(anggotaRows || [])
    const map: Record<string, Absensi> = {}
    for (const row of (absensiRows || []) as Absensi[]) {
      if (row.anggota_id) map[row.anggota_id] = row
    }
    setAbsensiMap(map)
    setLoadingDetail(false)
  }, [])

  const updateStatus = async (anggotaId: string, status: Absensi['status']) => {
    if (!selectedKegiatan || !status) return
    setSavingId(anggotaId)
    try {
      const existing = absensiMap[anggotaId]
      if (existing) {
        const { data: updated } = await supabase
          .from('absensi')
          .update({ status, keterangan: 'Koreksi manual pengurus' })
          .eq('id', existing.id)
          .select('*')
          .single()
        if (updated) setAbsensiMap(prev => ({ ...prev, [anggotaId]: updated as Absensi }))
      } else {
        const { data: inserted } = await supabase
          .from('absensi')
          .insert({
            kegiatan_id: selectedKegiatan.id,
            anggota_id: anggotaId,
            status,
            keterangan: 'Koreksi manual pengurus',
            waktu_absen: new Date().toISOString(),
          })
          .select('*')
          .single()
        if (inserted) setAbsensiMap(prev => ({ ...prev, [anggotaId]: inserted as Absensi }))
      }
      if (user) {
        await logAudit(user, 'UPDATE', 'Presensi', selectedKegiatan.nama_kegiatan, { anggota_id: anggotaId, status }, selectedKegiatan.id)
      }
    } finally {
      setSavingId(null)
    }
  }

  if (!canManage) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-2">🔒</div>
        <p>Halaman ini hanya untuk pengurus.</p>
      </div>
    )
  }

  const filteredKegiatan = kegiatanList.filter(k => {
    if (!search) return true
    return k.nama_kegiatan?.toLowerCase().includes(search.toLowerCase())
  })

  const rekap = {
    hadir: Object.values(absensiMap).filter(a => a.status === 'hadir').length,
    total: anggotaScope.length,
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-bold text-slate-800">Presensi</h2>
        <p className="text-slate-400 text-sm">Kelola dan koreksi kehadiran kegiatan</p>
      </div>

      {!selectedKegiatan ? (
        <>
          <input
            type="text"
            placeholder="Cari kegiatan..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {loadingKegiatan ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            </div>
          ) : filteredKegiatan.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <p>Belum ada kegiatan</p>
            </div>
          ) : (
            <div className="grid gap-3">
              {filteredKegiatan.map(k => (
                <button
                  key={k.id}
                  onClick={() => loadDetail(k)}
                  className="text-left bg-white rounded-2xl p-4 shadow-sm border border-slate-100 hover:shadow-md hover:border-blue-200 transition"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-slate-800">{k.nama_kegiatan}</h3>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusLabel[k.status]?.color}`}>{statusLabel[k.status]?.label}</span>
                      </div>
                      {k.tanggal_mulai && (
                        <p className="text-xs text-slate-400 mt-1">{new Date(k.tanggal_mulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                      )}
                    </div>
                    <span className="text-slate-300">→</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-3">
          <button onClick={() => setSelectedKegiatan(null)} className="text-sm text-blue-600 hover:underline font-medium">
            ← Kembali ke daftar kegiatan
          </button>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-800">{selectedKegiatan.nama_kegiatan}</h3>
            <p className="text-xs text-slate-400 mt-1">{rekap.hadir} / {rekap.total} anggota hadir</p>
          </div>

          {loadingDetail ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            </div>
          ) : anggotaScope.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <p>Tidak ada anggota dalam cakupan kegiatan ini</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
              {anggotaScope.map(a => {
                const absen = absensiMap[a.id]
                const currentStatus = absen?.status || null
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-700 text-sm truncate">{a.nama_lengkap}</p>
                      <p className="text-xs text-slate-400">{a.nomor_anggota}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentStatus && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${kehadiranLabel[currentStatus]?.color}`}>
                          {kehadiranLabel[currentStatus]?.label}
                        </span>
                      )}
                      <select
                        value={currentStatus || ''}
                        disabled={savingId === a.id}
                        onChange={e => updateStatus(a.id, e.target.value as Absensi['status'])}
                        className="px-2 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                      >
                        <option value="">-- Tandai --</option>
                        <option value="hadir">Hadir</option>
                        <option value="tidak_hadir">Tidak Hadir</option>
                        <option value="izin">Izin</option>
                        <option value="sakit">Sakit</option>
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
