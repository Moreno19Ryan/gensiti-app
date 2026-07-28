'use client'

import { useEffect, useState } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { BeritaLdii } from '@/lib/types'
import { SkeletonCards } from '@/components/Skeleton'

// Menu "Berita LDII" -- mirror ringkasan RSS feed publik ldii.or.id (organisasi induk),
// diperbarui otomatis tiap 4 jam lewat pg_cron -> Edge Function fetch-berita-ldii (lihat
// migrasi berita_ldii_rss_mirror & ARCHITECTURE.md §12). HANYA cuplikan + link ke sumber asli
// yang pernah disimpan -- tombol/kartu SELALU buka tab baru ke ldii.or.id, TIDAK PERNAH
// menampilkan isi artikel lengkap di dalam GENSITI (soal hak cipta). gambar_url juga cuma
// hotlink URL (diregex dari <img> pertama di content:encoded), bukan salinan file/teks.
//
// Desain kartu (redesain -- permintaan Reno: "semenarik mungkin agar Generus mau membaca")
// sengaja meniru pola artikel/majalah: kartu unggulan besar utk berita terbaru, grid galeri
// utk sisanya, badge "Baru" utk yang dipublish <48 jam terakhir supaya terasa hidup/update.
export default function BeritaLdiiPage() {
  const { user } = useUser()
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'berita-ldii')
  const [data, setData] = useState<BeritaLdii[]>([])
  const [loading, setLoading] = useState(true)
  // Snapshot waktu SEKALI saat mount (lazy initializer -- bukan dipanggil ulang tiap render)
  // supaya badge "Baru" tidak memanggil Date.now() langsung di badan render, yang dianggap
  // impure oleh aturan purity komponen -- pola sama seperti sisaDetik di PresensiPanel.tsx.
  const [now] = useState<number>(() => Date.now())

  useEffect(() => {
    if (!user) return
    supabase
      .from('berita_ldii')
      .select('id, judul, ringkasan, link, tanggal_publish, kategori, gambar_url')
      .order('tanggal_publish', { ascending: false })
      .limit(50)
      .then(({ data: rows, error }) => {
        if (error) console.error('Gagal memuat berita LDII:', error.message)
        setData(rows || [])
        setLoading(false)
      })
  }, [user])

  if (!featureChecking && !featureEnabled) {
    return (
      <div className="bg-white rounded-2xl p-12 text-center text-slate-400">
        <div className="text-4xl mb-3">🚫</div>
        <p className="font-semibold text-slate-600">Fitur Dinonaktifkan</p>
        <p className="text-sm mt-1">Menu Berita LDII saat ini dinonaktifkan oleh Super Admin untuk jenjang Anda.</p>
      </div>
    )
  }

  const isBaru = (tanggal: string | null) => {
    if (!tanggal) return false
    return now - new Date(tanggal).getTime() < 48 * 60 * 60 * 1000
  }

  const fmtTanggal = (tanggal: string | null) =>
    tanggal ? new Date(tanggal).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : ''

  const [unggulan, ...sisanya] = data

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-lg shrink-0">📰</div>
        <div>
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Berita LDII</h2>
          <p className="text-slate-400 text-xs">Kabar terkini dari ldii.or.id -- diperbarui otomatis tiap beberapa jam</p>
        </div>
      </div>

      {loading ? (
        <SkeletonCards />
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📰</div>
          <p>Belum ada berita nih</p>
        </div>
      ) : (
        <>
          {/* Kartu unggulan -- berita terbaru, tampil besar supaya jadi perhatian pertama */}
          <a
            href={unggulan.link}
            target="_blank"
            rel="noopener noreferrer"
            className="group block bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow"
          >
            <div className="relative aspect-[16/9] sm:aspect-[21/9] bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/40 dark:to-blue-900/40 overflow-hidden">
              {unggulan.gambar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={unggulan.gambar_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-6xl opacity-30">📰</div>
              )}
              {isBaru(unggulan.tanggal_publish) && (
                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full text-xs font-bold bg-red-500 text-white shadow">
                  🔥 Baru
                </span>
              )}
            </div>
            <div className="p-5">
              {unggulan.kategori.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap mb-2">
                  {unggulan.kategori.slice(0, 3).map(k => (
                    <span key={k} className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400">{k}</span>
                  ))}
                </div>
              )}
              <h3 className="font-extrabold text-slate-800 dark:text-slate-100 text-lg leading-snug group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                {unggulan.judul}
              </h3>
              {unggulan.ringkasan && (
                <p className="text-slate-500 dark:text-slate-400 text-sm mt-1.5 line-clamp-2">{unggulan.ringkasan}</p>
              )}
              <div className="flex items-center justify-between mt-3">
                <span className="text-xs text-slate-400">{fmtTanggal(unggulan.tanggal_publish)}</span>
                <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold flex items-center gap-1">
                  Baca Selengkapnya <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                </span>
              </div>
            </div>
          </a>

          {/* Grid galeri -- sisa berita, 1 kolom di HP, 2 kolom di layar lebih lebar */}
          {sisanya.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {sisanya.map(b => (
                <a
                  key={b.id}
                  href={b.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex gap-3 bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition"
                >
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/40 dark:to-blue-900/40">
                    {b.gambar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={b.gambar_url} alt="" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-2xl opacity-30">📰</div>
                    )}
                    {isBaru(b.tanggal_publish) && (
                      <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-red-500 text-white shadow">Baru</span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1 flex flex-col">
                    {b.kategori.length > 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-0.5">{b.kategori[0]}</span>
                    )}
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {b.judul}
                    </h3>
                    <div className="mt-auto pt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">{fmtTanggal(b.tanggal_publish)}</span>
                      <span className="text-blue-600 dark:text-blue-400 text-[11px] font-semibold shrink-0">Baca →</span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
