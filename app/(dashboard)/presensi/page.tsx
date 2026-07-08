'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { Kegiatan, Absensi, PengajuanIzinPresensi } from '@/lib/types'
import { logAudit } from '@/lib/audit'
import { canManagePresensi } from '@/lib/roles'
import { ExportOptions } from '@/lib/export'
import ExportPreviewModal from '@/components/ExportPreviewModal'

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

const kelasNgajiLabel: Record<string, string> = {
  pra_remaja: 'Pra Remaja',
  remaja_muda: 'Remaja Muda',
  remaja_dewasa: 'Remaja Dewasa',
}

type GenerusRow = {
  id: string
  nomor_generus: string
  nama_panggilan: string | null
  jenis_kelamin: string | null
  kelas_ngaji: string | null
  desa_id: string | null
  kelompok_id: string | null
  users: { nama_lengkap: string } | null
}

// Halaman koreksi manual presensi — kelola (ubah status kehadiran) hanya untuk Ketua/Wakil
// Ketua & Sekretaris (selaras dengan siapa yang boleh membuka sesi presensi di PresensiPanel).
// Super Admin BISA MEMBUKA halaman ini untuk melihat rekap presensi (read-only, sejak audit
// peran) tapi tidak bisa mengubah status kehadiran siapapun -- lihat canView vs canManage.
// Alurnya: pilih kegiatan -> lihat semua Generus dalam scope kegiatan tsb beserta status
// kehadirannya -> yang berwenang kelola bisa diedit manual kapan saja (mis. Generus lupa
// self check-in, atau ijin/sakit).
export default function PresensiPage() {
  const { user } = useUser()
  const canManage = canManagePresensi(user)
  const isSuperAdmin = user?.role?.tingkatan === 'super_admin'
  const canView = canManage || isSuperAdmin

  const [kegiatanList, setKegiatanList] = useState<Kegiatan[]>([])
  const [selectedKegiatan, setSelectedKegiatan] = useState<Kegiatan | null>(null)
  const [loadingKegiatan, setLoadingKegiatan] = useState(true)
  const [search, setSearch] = useState('')

  const [generusScope, setGenerusScope] = useState<GenerusRow[]>([])
  const [absensiMap, setAbsensiMap] = useState<Record<string, Absensi>>({})
  // Nama pengurus yang melakukan koreksi manual (key: user id dari absensi.dikoreksi_oleh) --
  // dipakai untuk badge "Dikoreksi oleh ..." di daftar, supaya tidak perlu join manual di
  // query utama (baris yang tidak pernah dikoreksi tidak butuh data ini sama sekali).
  const [koreksiUserMap, setKoreksiUserMap] = useState<Record<string, string>>({})
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  // Pengajuan izin dari Generus yang masih menunggu keputusan pengurus, utk kegiatan yang
  // sedang dibuka -- ditampilkan sbg panel terpisah di atas daftar Generus, HANYA utk yang
  // berwenang KELOLA presensi (canManage), sama seperti dropdown koreksi status di bawah.
  const [pengajuanIzinList, setPengajuanIzinList] = useState<PengajuanIzinPresensi[]>([])
  const [prosesIzinId, setProsesIzinId] = useState<string | null>(null)

  // Daftar desa/kelompok dipakai utk (1) label nama pada filter cetak & (2) menerjemahkan
  // desa_id/kelompok_id Generus jadi nama yang bisa dibaca manusia di daftar & export.
  const [desaList, setDesaList] = useState<{ id: string; nama_desa: string }[]>([])
  const [kelompokList, setKelompokList] = useState<{ id: string; nama_kelompok: string; desa_id: string | null }[]>([])
  // Filter cetak/tampil per desa/kelompok -- relevan terutama utk kegiatan tingkat Daerah yang
  // pesertanya lintas desa/kelompok. Format nilai: 'semua' | `desa:{id}` | `kelompok:{id}`.
  const [filterWilayah, setFilterWilayah] = useState<string>('semua')

  const loadKegiatan = useCallback(async () => {
    setLoadingKegiatan(true)
    // Limit 500 -- daftar kegiatan untuk dipilih, bukan laporan lengkap; pengaman supaya
    // query tidak membengkak seiring histori kegiatan bertambah dari tahun ke tahun.
    let query = supabase.from('kegiatan').select('*').order('tanggal_mulai', { ascending: false }).limit(500)
    const t = user?.role?.tingkatan
    if (t !== 'super_admin' && t !== 'daerah') {
      if (user?.kelompok_id) query = query.eq('kelompok_id', user.kelompok_id)
      else if (user?.desa_id) query = query.eq('desa_id', user.desa_id)
    }
    const { data, error: err } = await query
    if (err) { console.error('Gagal memuat daftar kegiatan:', err.message) }
    setKegiatanList(data || [])
    setLoadingKegiatan(false)
  }, [user])

  useEffect(() => {
    if (user && canView) loadKegiatan()
  }, [user, canView, loadKegiatan])

  useEffect(() => {
    if (!user || !canView) return
    ;(async () => {
      const [{ data: desaRows, error: errDesa }, { data: kelompokRows, error: errKelompok }] = await Promise.all([
        supabase.from('desa').select('id, nama_desa').eq('is_active', true).order('nama_desa'),
        supabase.from('kelompok').select('id, nama_kelompok, desa_id').eq('is_active', true).order('nama_kelompok'),
      ])
      if (errDesa) console.error('Gagal memuat daftar desa:', errDesa.message)
      if (errKelompok) console.error('Gagal memuat daftar kelompok:', errKelompok.message)
      setDesaList(desaRows || [])
      setKelompokList(kelompokRows || [])
    })()
  }, [user, canView])

  const loadDetail = useCallback(async (kegiatan: Kegiatan) => {
    setLoadingDetail(true)
    setSelectedKegiatan(kegiatan)
    setFilterWilayah('semua')

    // Generus dalam scope kegiatan (mengikuti tempat sambung TERKINI, bukan snapshot historis)
    let generusQuery = supabase
      .from('generus')
      .select('id, nomor_generus, nama_panggilan, jenis_kelamin, kelas_ngaji, desa_id, kelompok_id, users:user_id(nama_lengkap)')
      .eq('status', 'aktif')
    if (kegiatan.tingkatan === 'kelompok' && kegiatan.kelompok_id) {
      generusQuery = generusQuery.eq('kelompok_id', kegiatan.kelompok_id)
    } else if (kegiatan.tingkatan === 'desa' && kegiatan.desa_id) {
      generusQuery = generusQuery.eq('desa_id', kegiatan.desa_id)
    } else if (kegiatan.desa_id) {
      generusQuery = generusQuery.eq('desa_id', kegiatan.desa_id)
    } else if (kegiatan.kelompok_id) {
      generusQuery = generusQuery.eq('kelompok_id', kegiatan.kelompok_id)
    }
    // tingkatan 'daerah' tanpa desa_id/kelompok_id -> seluruh Generus daerah (tidak difilter tambahan)

    const [{ data: generusRows, error: errGenerus }, { data: absensiRows, error: errAbsensi }] = await Promise.all([
      generusQuery.limit(1000),
      // Limit 1000 -- absensi per kegiatan dibatasi jumlah Generus dalam scope-nya, tapi
      // tetap diberi pengaman untuk kegiatan tingkat Daerah dengan peserta sangat banyak.
      supabase.from('absensi').select('*').eq('kegiatan_id', kegiatan.id).limit(1000),
    ])
    if (errGenerus) console.error('Gagal memuat daftar Generus:', errGenerus.message)
    if (errAbsensi) console.error('Gagal memuat data absensi:', errAbsensi.message)

    // PostgREST/Supabase JS menyimpulkan tipe embed users(...) di sini sbg array (beda dari
    // kasus query dari arah users->generus yg lain di app ini) meski relasinya tetap 1-ke-1
    // (generus.user_id UNIQUE) -- dinormalisasi ke objek tunggal di sini supaya konsisten &
    // seluruh kode di bawah tidak perlu tahu perbedaan bentuk data mentah dari Supabase.
    const normalized: GenerusRow[] = (generusRows || []).map(g => ({
      id: g.id,
      nomor_generus: g.nomor_generus,
      nama_panggilan: g.nama_panggilan,
      jenis_kelamin: g.jenis_kelamin,
      kelas_ngaji: g.kelas_ngaji,
      desa_id: g.desa_id,
      kelompok_id: g.kelompok_id,
      users: Array.isArray(g.users) ? (g.users[0] ?? null) : g.users,
    }))
    // Diurutkan di client (bukan .order() PostgREST) krn nama_lengkap sekarang berasal dari
    // relasi users, bukan kolom langsung di tabel generus yang di-query.
    const sortedGenerus = normalized.sort((a, b) =>
      (a.users?.nama_lengkap || '').localeCompare(b.users?.nama_lengkap || '')
    )
    setGenerusScope(sortedGenerus)
    const map: Record<string, Absensi> = {}
    for (const row of (absensiRows || []) as Absensi[]) {
      if (row.generus_id) map[row.generus_id] = row
    }
    setAbsensiMap(map)

    // Ambil nama pengurus yang pernah melakukan koreksi manual pada kegiatan ini (kalau ada)
    // -- query terpisah & hanya jalan kalau memang ada baris yang punya dikoreksi_oleh,
    // supaya kegiatan tanpa koreksi sama sekali tidak menambah round-trip percuma.
    const koreksiUserIds = Array.from(new Set(
      (absensiRows || []).map(r => (r as Absensi).dikoreksi_oleh).filter((v): v is string => !!v)
    ))
    if (koreksiUserIds.length > 0) {
      const { data: koreksiUsers, error: errKoreksiUsers } = await supabase
        .from('users')
        .select('id, nama_lengkap')
        .in('id', koreksiUserIds)
      if (errKoreksiUsers) console.error('Gagal memuat nama pengoreksi:', errKoreksiUsers.message)
      const umap: Record<string, string> = {}
      for (const u of (koreksiUsers || []) as { id: string; nama_lengkap: string }[]) {
        umap[u.id] = u.nama_lengkap
      }
      setKoreksiUserMap(umap)
    } else {
      setKoreksiUserMap({})
    }

    // Daftar pengajuan izin yang masih menunggu keputusan, khusus kegiatan ini -- ditampilkan
    // sbg panel approval terpisah. RLS pengajuan_izin_select_pengurus sudah membatasi hanya
    // baris dalam scope pengurus yang login, query di sini tinggal filter status+kegiatan.
    const { data: pengajuanRows, error: errPengajuan } = await supabase
      .from('pengajuan_izin_presensi')
      .select('*, generus:generus_id(id, nomor_generus, users:user_id(nama_lengkap))')
      .eq('kegiatan_id', kegiatan.id)
      .eq('status', 'menunggu')
      .order('diajukan_at', { ascending: true })
    if (errPengajuan) console.error('Gagal memuat pengajuan izin:', errPengajuan.message)
    const normalizedPengajuan: PengajuanIzinPresensi[] = (pengajuanRows || []).map((p) => ({
      ...p,
      generus: Array.isArray(p.generus) ? (p.generus[0] ?? null) : p.generus,
    }))
    setPengajuanIzinList(normalizedPengajuan)

    setLoadingDetail(false)
  }, [])

  const updateStatus = async (generusId: string, status: Absensi['status']) => {
    if (!selectedKegiatan || !status || !user) return
    setSavingId(generusId)
    try {
      // Status sebelumnya (dari state client, sumber tampilan saat ini) -- dipakai untuk
      // jejak audit koreksi (dikoreksi_oleh/dikoreksi_at/status_sebelum_koreksi). Baris yang
      // belum pernah punya status sebelumnya (murni pertama kali ditandai, belum sempat
      // self check-in ataupun dikoreksi) tidak dianggap "koreksi" -- kolom jejak dibiarkan
      // NULL supaya badge "Dikoreksi manual" hanya muncul untuk perubahan status yang
      // sesungguhnya (mis. Generus sudah self check-in 'hadir' lalu pengurus ubah jadi 'izin').
      const statusSebelumnya = absensiMap[generusId]?.status ?? null
      const adalahKoreksi = statusSebelumnya !== null && statusSebelumnya !== status

      // Upsert by (kegiatan_id, generus_id) alih-alih cek "existing" dari state client lalu
      // pilih update/insert manual -- pola lama rawan race condition: kalau ada 2 aksi hampir
      // bersamaan utk kombinasi kegiatan+generus yg sama (mis. Generus self check-in via
      // submit_presensi tepat saat pengurus mengoreksi manual di sini), dua-duanya bisa lolos
      // cek "existing" kosong lalu sama-sama INSERT, menghasilkan baris absensi duplikat.
      // Sekarang dijamin database via constraint UNIQUE(kegiatan_id, generus_id) + upsert.
      const { data: saved, error: err } = await supabase
        .from('absensi')
        .upsert(
          {
            kegiatan_id: selectedKegiatan.id,
            generus_id: generusId,
            status,
            keterangan: 'Koreksi manual pengurus',
            waktu_absen: new Date().toISOString(),
            ...(adalahKoreksi
              ? { dikoreksi_oleh: user.id, dikoreksi_at: new Date().toISOString(), status_sebelum_koreksi: statusSebelumnya }
              : {}),
          },
          { onConflict: 'kegiatan_id,generus_id' }
        )
        .select('*')
        .single()

      if (err) {
        alert(`Gagal menyimpan koreksi kehadiran: ${err.message}`)
        return
      }
      if (saved) setAbsensiMap(prev => ({ ...prev, [generusId]: saved as Absensi }))

      await logAudit(
        user,
        'UPDATE',
        'Presensi',
        selectedKegiatan.nama_kegiatan,
        adalahKoreksi
          ? { generus_id: generusId, status, status_sebelum: statusSebelumnya, jenis: 'koreksi_manual' }
          : { generus_id: generusId, status },
        selectedKegiatan.id
      )
    } finally {
      setSavingId(null)
    }
  }

  // Setuju/tolak pengajuan izin -- panggil RPC proses_izin_presensi (bukan update tabel
  // langsung) supaya insert/update absensi + notifikasi ke Generus terjadi atomik di sisi
  // server (lihat migrasi rpc_ajukan_dan_proses_izin_presensi), konsisten dgn pola
  // proses_reimbursement yang sudah ada utk alur approval keuangan.
  const prosesIzin = async (pengajuan: PengajuanIzinPresensi, keputusan: 'disetujui' | 'ditolak') => {
    setProsesIzinId(pengajuan.id)
    try {
      const { error: err } = await supabase.rpc('proses_izin_presensi', {
        p_pengajuan_id: pengajuan.id,
        p_keputusan: keputusan,
      })
      if (err) {
        alert(`Gagal memproses pengajuan izin: ${err.message}`)
        return
      }
      setPengajuanIzinList(prev => prev.filter(p => p.id !== pengajuan.id))
      // Kalau disetujui, absensi Generus ybs berubah jadi 'izin' di server -- refresh detail
      // supaya daftar Generus & badge status di bawah langsung mencerminkan perubahan itu,
      // tanpa perlu pengurus pindah halaman lalu balik lagi.
      if (keputusan === 'disetujui' && selectedKegiatan) {
        await loadDetail(selectedKegiatan)
      }
      if (user) {
        await logAudit(
          user,
          'UPDATE',
          'Presensi',
          selectedKegiatan?.nama_kegiatan || '',
          { pengajuan_izin_id: pengajuan.id, generus_id: pengajuan.generus_id, keputusan },
          selectedKegiatan?.id
        )
      }
    } finally {
      setProsesIzinId(null)
    }
  }

  // Opsi filter wilayah hanya ditawarkan kalau memang ada keragaman desa/kelompok dalam
  // scope kegiatan yang sedang dibuka -- percuma tampilkan dropdown filter kalau kegiatan
  // itu sendiri sudah dibatasi ke satu kelompok saja (semua barisnya toh sama).
  const wilayahOptions = useMemo(() => {
    const desaIds = new Set(generusScope.map(g => g.desa_id).filter(Boolean))
    const kelompokIds = new Set(generusScope.map(g => g.kelompok_id).filter(Boolean))
    if (desaIds.size <= 1 && kelompokIds.size <= 1) return []
    const opts: { value: string; label: string }[] = []
    for (const d of desaList) {
      if (desaIds.has(d.id)) opts.push({ value: `desa:${d.id}`, label: `Desa ${d.nama_desa}` })
    }
    for (const k of kelompokList) {
      if (kelompokIds.has(k.id)) opts.push({ value: `kelompok:${k.id}`, label: `Kelompok ${k.nama_kelompok}` })
    }
    return opts
  }, [generusScope, desaList, kelompokList])

  const scopedGenerus = useMemo(() => {
    if (filterWilayah === 'semua') return generusScope
    const [tipe, id] = filterWilayah.split(':')
    if (tipe === 'desa') return generusScope.filter(g => g.desa_id === id)
    if (tipe === 'kelompok') return generusScope.filter(g => g.kelompok_id === id)
    return generusScope
  }, [generusScope, filterWilayah])

  if (!canView) {
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
    hadir: scopedGenerus.filter(g => absensiMap[g.id]?.status === 'hadir').length,
    total: scopedGenerus.length,
  }

  const namaWilayahDipilih = () => {
    if (filterWilayah === 'semua') return ''
    const opt = wilayahOptions.find(o => o.value === filterWilayah)
    return opt ? opt.label : ''
  }

  const jamHadir = (generusId: string) => {
    const waktu = absensiMap[generusId]?.waktu_absen
    if (!waktu) return '-'
    return new Date(waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  }

  // Export rekap kehadiran untuk kegiatan yang sedang dibuka (mengikuti filter wilayah aktif)
  // -- daftar semua Generus dalam cakupan tsb beserta status & jam kehadirannya (termasuk
  // yang belum ditandai).
  const exportColumns = [
    { header: 'No. Generus', key: 'no', width: 16 },
    { header: 'Nama Lengkap', key: 'nama', width: 26 },
    { header: 'Nama Panggilan', key: 'panggilan', width: 18 },
    { header: 'Jenis Kelamin', key: 'jk', width: 14 },
    { header: 'Kelas Ngaji', key: 'kelas_ngaji', width: 18 },
    { header: 'Jam Hadir', key: 'jam', width: 12 },
    { header: 'Status Kehadiran', key: 'status', width: 18 },
  ]

  const buildExportData = () => scopedGenerus.map(a => {
    const status = absensiMap[a.id]?.status
    return {
      no: a.nomor_generus,
      nama: a.users?.nama_lengkap || '-',
      panggilan: a.nama_panggilan || '-',
      jk: a.jenis_kelamin === 'laki-laki' ? 'Laki-laki' : a.jenis_kelamin === 'perempuan' ? 'Perempuan' : '-',
      kelas_ngaji: a.kelas_ngaji ? (kelasNgajiLabel[a.kelas_ngaji] || a.kelas_ngaji) : '-',
      jam: status === 'hadir' ? jamHadir(a.id) : '-',
      status: status ? kehadiranLabel[status]?.label : 'Belum Ditandai',
    }
  })

  const exportSummary = () => [
    { label: 'Hadir', value: `${scopedGenerus.filter(g => absensiMap[g.id]?.status === 'hadir').length} orang` },
    { label: 'Tidak Hadir', value: `${scopedGenerus.filter(g => absensiMap[g.id]?.status === 'tidak_hadir').length} orang` },
    { label: 'Izin', value: `${scopedGenerus.filter(g => absensiMap[g.id]?.status === 'izin').length} orang` },
    { label: 'Sakit', value: `${scopedGenerus.filter(g => absensiMap[g.id]?.status === 'sakit').length} orang` },
    { label: 'Total Generus', value: `${rekap.total} orang` },
  ]

  const exportSubtitle = () => {
    const tgl = selectedKegiatan?.tanggal_mulai
      ? new Date(selectedKegiatan.tanggal_mulai).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      : ''
    const wilayah = namaWilayahDipilih()
    return `${selectedKegiatan?.nama_kegiatan || ''}${tgl ? ` -- ${tgl}` : ''}${wilayah ? ` -- ${wilayah}` : ''}`
  }

  const exportFileName = () => {
    const base = selectedKegiatan?.nama_kegiatan.replace(/[^a-zA-Z0-9]/g, '-') || 'Presensi'
    const wilayah = namaWilayahDipilih().replace(/[^a-zA-Z0-9]/g, '-')
    return `Presensi-${base}${wilayah ? `-${wilayah}` : ''}`
  }

  // Opsi export yang sedang aktif, dihitung ulang setiap filter wilayah berubah -- diteruskan
  // ke ExportPreviewModal supaya pratinjau PDF selalu mencerminkan filter TERKINI, termasuk
  // saat user mengubah filter wilayah sambil modal preview masih terbuka.
  const previewOptions: ExportOptions = {
    title: 'Rekap Presensi Kegiatan',
    subtitle: exportSubtitle(),
    columns: exportColumns,
    rows: buildExportData(),
    summary: exportSummary(),
    fileName: exportFileName(),
  }

  const handleOpenPreview = () => {
    if (!selectedKegiatan || scopedGenerus.length === 0) { alert('Tidak ada data Generus untuk diexport.'); return }
    setPreviewOpen(true)
  }

  const handleExported = async (format: 'pdf' | 'excel') => {
    if (!user || !selectedKegiatan) return
    await logAudit(
      user,
      'EXPORT',
      'Presensi',
      `${format === 'pdf' ? 'PDF' : 'Excel'} -- ${selectedKegiatan.nama_kegiatan}${namaWilayahDipilih() ? ` (${namaWilayahDipilih()})` : ''}`,
      undefined,
      selectedKegiatan.id
    )
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
          <div className="flex items-center justify-between flex-wrap gap-2">
            <button onClick={() => setSelectedKegiatan(null)} className="text-sm text-blue-600 hover:underline font-medium">
              ← Kembali ke daftar kegiatan
            </button>
            <div className="flex items-center gap-2">
              <button onClick={handleOpenPreview} disabled={loadingDetail}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5">
                🔍 Pratinjau & Export
              </button>
            </div>
          </div>
          <div className="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <h3 className="font-semibold text-slate-800">{selectedKegiatan.nama_kegiatan}</h3>
            <p className="text-xs text-slate-400 mt-1">{rekap.hadir} / {rekap.total} Generus hadir{namaWilayahDipilih() ? ` -- ${namaWilayahDipilih()}` : ''}</p>
          </div>

          {/* Filter cetak/tampil per desa/kelompok -- hanya muncul kalau scope kegiatan
              memang mencakup lebih dari satu desa/kelompok (mis. kegiatan tingkat Daerah).
              Filter ini juga otomatis diikutsertakan di export PDF/Excel & judul laporan. */}
          {wilayahOptions.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-400 shrink-0">Cetak/Tampilkan untuk:</label>
              <select
                value={filterWilayah}
                onChange={e => setFilterWilayah(e.target.value)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="semua">Semua Desa/Kelompok</option>
                {wilayahOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Panel approval pengajuan izin -- hanya utk yang berwenang KELOLA presensi
              (Ketua/Wapon/Sekretaris), sama seperti dropdown koreksi status di bawah.
              Muncul di atas daftar Generus supaya pengurus langsung lihat & proses pengajuan
              yang menunggu tanpa perlu scroll cari satu per satu di daftar Generus. */}
          {canManage && pengajuanIzinList.length > 0 && (
            <div className="bg-amber-50 rounded-2xl border border-amber-100 divide-y divide-amber-100">
              <div className="px-4 py-2.5">
                <h4 className="text-sm font-semibold text-amber-800">📋 Pengajuan Izin Menunggu ({pengajuanIzinList.length})</h4>
              </div>
              {pengajuanIzinList.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 text-sm truncate">{p.generus?.users?.nama_lengkap || '(nama tidak ditemukan)'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">{p.alasan}</p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{new Date(p.diajukan_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => prosesIzin(p, 'disetujui')}
                      disabled={prosesIzinId === p.id}
                      className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition"
                    >
                      Setujui
                    </button>
                    <button
                      onClick={() => prosesIzin(p, 'ditolak')}
                      disabled={prosesIzinId === p.id}
                      className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 text-xs font-medium rounded-lg hover:bg-slate-50 disabled:opacity-50 transition"
                    >
                      Tolak
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadingDetail ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            </div>
          ) : scopedGenerus.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
              <p>Tidak ada Generus dalam cakupan ini</p>
            </div>
          ) : (
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 divide-y divide-slate-100">
              {scopedGenerus.map(a => {
                const absen = absensiMap[a.id]
                const currentStatus = absen?.status || null
                return (
                  <div key={a.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="font-medium text-slate-700 text-sm truncate">{a.users?.nama_lengkap || '(nama tidak ditemukan)'}</p>
                      <p className="text-xs text-slate-400">
                        {a.nomor_generus}
                        {a.nama_panggilan ? ` · ${a.nama_panggilan}` : ''}
                        {a.jenis_kelamin ? ` · ${a.jenis_kelamin === 'laki-laki' ? 'L' : 'P'}` : ''}
                        {a.kelas_ngaji ? ` · ${kelasNgajiLabel[a.kelas_ngaji] || a.kelas_ngaji}` : ''}
                      </p>
                      {currentStatus === 'hadir' && (
                        <p className="text-xs text-slate-300 mt-0.5">Hadir pukul {jamHadir(a.id)}</p>
                      )}
                      {/* Jejak audit koreksi manual -- hanya tampil untuk baris yang memang
                          pernah diubah statusnya oleh pengurus (bukan hasil self check-in
                          murni). Menampilkan siapa, kapan, dan status sebelum dikoreksi supaya
                          ada akuntabilitas & transparansi kalau ada kekeliruan/kecurigaan. */}
                      {absen?.dikoreksi_oleh && absen?.dikoreksi_at && (
                        <p className="text-xs text-amber-500 mt-0.5" title={`Sebelumnya: ${absen.status_sebelum_koreksi ? (kehadiranLabel[absen.status_sebelum_koreksi]?.label || absen.status_sebelum_koreksi) : '-'}`}>
                          Dikoreksi {koreksiUserMap[absen.dikoreksi_oleh] ? `oleh ${koreksiUserMap[absen.dikoreksi_oleh]}` : ''} - {new Date(absen.dikoreksi_at).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {currentStatus && (
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${kehadiranLabel[currentStatus]?.color}`}>
                          {kehadiranLabel[currentStatus]?.label}
                        </span>
                      )}
                      {/* Dropdown koreksi status hanya untuk yang berwenang KELOLA presensi
                          (Ketua/Wakil/Sekretaris) -- Super Admin cuma bisa lihat badge status
                          di atas, tidak bisa mengubah kehadiran siapapun (read-only, sejak
                          audit peran Super Admin). */}
                      {canManage && (
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
                      )}
                      {!canManage && !currentStatus && (
                        <span className="text-xs text-slate-300 italic">Belum ditandai</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      <ExportPreviewModal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        options={previewOptions}
        onExported={handleExported}
      />
    </div>
  )
}
