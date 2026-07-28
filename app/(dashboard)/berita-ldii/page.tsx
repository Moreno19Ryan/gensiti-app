'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import { useUser } from '@/lib/user-context'
import { supabase } from '@/lib/supabase'
import { useFeatureAccess } from '@/lib/feature-toggles'
import { BeritaLdii } from '@/lib/types'
import { SkeletonCards } from '@/components/Skeleton'

const WhatsappIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413" />
  </svg>
)

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
//
// Kartu pakai pola "stretched link" (bukan <a> membungkus semua): satu <a> absolute inset-0
// jadi target klik utama, konten di atasnya diberi pointer-events-none supaya klik tetap
// tembus ke <a>, KECUALI tombol "Bagikan" yang di-pointer-events-auto sendiri -- ini supaya
// tombol Bagikan bisa punya onClick sendiri tanpa nested <a> di dalam <a> (invalid HTML).
export default function BeritaLdiiPage() {
  const { user } = useUser()
  const { enabled: featureEnabled, checking: featureChecking } = useFeatureAccess(user, 'berita-ldii')
  const [data, setData] = useState<BeritaLdii[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterKategori, setFilterKategori] = useState('')
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

  const bagikanWhatsapp = (e: MouseEvent<HTMLButtonElement>, judul: string, link: string) => {
    e.preventDefault()
    e.stopPropagation()
    const teks = `${judul}\n${link}`
    window.open(`https://wa.me/?text=${encodeURIComponent(teks)}`, '_blank', 'noopener,noreferrer')
  }

  const kategoriUnik = Array.from(new Set(data.flatMap(b => b.kategori))).sort((a, b) => a.localeCompare(b))

  const filtered = data.filter(b => {
    const q = search.trim().toLowerCase()
    const matchSearch = !q || b.judul.toLowerCase().includes(q) || (b.ringkasan?.toLowerCase().includes(q) ?? false)
    const matchKategori = !filterKategori || b.kategori.includes(filterKategori)
    return matchSearch && matchKategori
  })

  const adaFilterAktif = search.trim() !== '' || filterKategori !== ''
  const resetFilter = () => { setSearch(''); setFilterKategori('') }

  const [unggulan, ...sisanya] = filtered

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center text-lg shrink-0">📰</div>
        <div>
          <h2 className="font-bold text-slate-800 dark:text-slate-100">Berita LDII</h2>
          <p className="text-slate-400 text-xs">Kabar terkini dari ldii.or.id -- diperbarui otomatis tiap beberapa jam</p>
        </div>
      </div>

      {!loading && data.length > 0 && (
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            placeholder="Cari judul atau ringkasan berita..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="flex-1 min-w-[200px] px-4 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          />
          <select
            value={filterKategori}
            onChange={e => setFilterKategori(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          >
            <option value="">Semua Kategori</option>
            {kategoriUnik.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        </div>
      )}

      {loading ? (
        <SkeletonCards />
      ) : data.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">📰</div>
          <p>Belum ada berita nih</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-12 text-center text-slate-400">
          <div className="text-4xl mb-2">🔍</div>
          <p>Tidak ada berita yang cocok dengan pencarian/filter kamu</p>
          {adaFilterAktif && (
            <button onClick={resetFilter} className="mt-3 text-blue-600 dark:text-blue-400 text-sm font-semibold hover:underline">
              Reset filter
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Kartu unggulan -- berita terbaru, tampil besar supaya jadi perhatian pertama */}
          <div className="group relative bg-white dark:bg-slate-800 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-700 overflow-hidden hover:shadow-lg transition-shadow">
            <a
              href={unggulan.link}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={unggulan.judul}
              className="absolute inset-0 z-0"
            />
            <div className="relative z-[1] pointer-events-none">
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
                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => bagikanWhatsapp(e, unggulan.judul, unggulan.link)}
                      className="pointer-events-auto px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1.5"
                    >
                      <WhatsappIcon className="w-3.5 h-3.5" />
                      Bagikan ke WhatsApp
                    </button>
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold flex items-center gap-1">
                      Baca Selengkapnya <span className="group-hover:translate-x-0.5 transition-transform">→</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Grid galeri -- sisa berita, 1 kolom di HP, 2 kolom di layar lebih lebar */}
          {sisanya.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-3">
              {sisanya.map(b => (
                <div
                  key={b.id}
                  className="group relative flex gap-3 bg-white dark:bg-slate-800 rounded-2xl p-3 shadow-sm border border-slate-100 dark:border-slate-700 hover:shadow-md hover:border-blue-200 dark:hover:border-blue-800 transition"
                >
                  <a
                    href={b.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={b.judul}
                    className="absolute inset-0 z-0 rounded-2xl"
                  />
                  <div className="relative z-[1] w-24 h-24 sm:w-28 sm:h-28 rounded-xl overflow-hidden shrink-0 bg-gradient-to-br from-indigo-100 to-blue-100 dark:from-indigo-900/40 dark:to-blue-900/40 pointer-events-none">
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
                  <div className="relative z-[1] min-w-0 flex-1 flex flex-col pointer-events-none">
                    {b.kategori.length > 0 && (
                      <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-500 dark:text-indigo-400 mb-0.5">{b.kategori[0]}</span>
                    )}
                    <h3 className="font-semibold text-slate-800 dark:text-slate-100 text-sm leading-snug line-clamp-2 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                      {b.judul}
                    </h3>
                    <div className="mt-auto pt-1 flex items-center justify-between gap-2">
                      <span className="text-[11px] text-slate-400">{fmtTanggal(b.tanggal_publish)}</span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={e => bagikanWhatsapp(e, b.judul, b.link)}
                          aria-label="Bagikan ke WhatsApp"
                          title="Bagikan ke WhatsApp"
                          className="pointer-events-auto w-5 h-5 flex items-center justify-center rounded-full bg-green-50 text-green-700 hover:bg-green-100 dark:bg-green-900/30 dark:text-green-400 dark:hover:bg-green-900/50 transition-colors"
                        >
                          <WhatsappIcon className="w-3 h-3" />
                        </button>
                        <span className="text-blue-600 dark:text-blue-400 text-[11px] font-semibold">Baca →</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
