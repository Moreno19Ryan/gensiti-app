'use client'

import { useEffect, useMemo, useState } from 'react'
import { ExportOptions, exportToPDF, exportToExcel, getPdfPreviewDataUrl } from '@/lib/export'

interface Props {
  open: boolean
  onClose: () => void
  // Opsi export -- dihitung ulang oleh halaman pemanggil setiap kali filter berubah, jadi
  // props ini SUDAH mencerminkan filter/scope yang sedang dipilih user saat modal dibuka.
  options: ExportOptions | null
  onExported?: (format: 'pdf' | 'excel') => void
}

// Modal pratinjau laporan (Presensi, Keuangan, dst) sebelum benar-benar diunduh --
// menampilkan PDF asli (persis file yang akan tersimpan, bukan tiruan) di dalam <iframe>
// via data URL dari getPdfPreviewDataUrl, supaya user bisa mengecek dulu isi & format
// laporan sebelum menekan tombol Export PDF/Excel final. Dipakai bersama oleh halaman
// Presensi & Keuangan (dan bisa dipakai halaman lain yang sudah pakai lib/export.ts).
export default function ExportPreviewModal({ open, onClose, options, onExported }: Props) {
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingExcel, setExportingExcel] = useState(false)

  useEffect(() => {
    if (open) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  // Data URL PDF dibangun ulang setiap kali `options` berubah (mis. user ganti filter
  // sambil modal masih terbuka) atau modal baru dibuka -- useMemo supaya tidak dibangun
  // ulang percuma di setiap render kalau opsinya sama.
  const previewUrl = useMemo(() => {
    if (!open || !options) return null
    if (options.rows.length === 0) return null
    try {
      return getPdfPreviewDataUrl(options)
    } catch (e) {
      console.error('Gagal membangun pratinjau PDF:', e)
      return null
    }
  }, [open, options])

  if (!open) return null

  const handleExportPDF = () => {
    if (!options) return
    setExportingPdf(true)
    try {
      exportToPDF(options)
      onExported?.('pdf')
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportExcel = async () => {
    if (!options) return
    setExportingExcel(true)
    try {
      await exportToExcel(options)
      onExported?.('excel')
    } finally {
      setExportingExcel(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Modal -- dilebarkan (bukan pakai komponen Modal umum yg maks max-w-2xl) supaya
          iframe pratinjau PDF tidak sempit dan tetap terbaca. */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Pratinjau Laporan</h2>
            {options?.subtitle && <p className="text-xs text-slate-400 mt-0.5">{options.subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition"
          >
            ✕
          </button>
        </div>

        {/* Content -- preview PDF */}
        <div className="flex-1 overflow-hidden bg-slate-100 p-3">
          {!options || options.rows.length === 0 ? (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
              Tidak ada data untuk ditampilkan pada filter ini.
            </div>
          ) : previewUrl ? (
            <iframe
              src={previewUrl}
              title="Pratinjau Laporan PDF"
              className="w-full h-full rounded-xl border border-slate-200 bg-white"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm">
              Gagal membuat pratinjau. Coba export langsung, atau tutup dan buka kembali pratinjau ini.
            </div>
          )}
        </div>

        {/* Footer -- ringkasan singkat + tombol export final */}
        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs text-slate-400">
            {options ? `${options.rows.length} baris data` : ''}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition"
            >
              Tutup
            </button>
            <button
              onClick={handleExportPDF}
              disabled={!options || options.rows.length === 0 || exportingPdf}
              className="px-4 py-2 bg-white border border-slate-200 text-slate-600 text-sm font-medium rounded-xl hover:bg-slate-50 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {exportingPdf ? 'Menyimpan...' : '📄 Export PDF'}
            </button>
            <button
              onClick={handleExportExcel}
              disabled={!options || options.rows.length === 0 || exportingExcel}
              className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-1.5"
            >
              {exportingExcel ? 'Menyimpan...' : '📊 Export Excel'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
