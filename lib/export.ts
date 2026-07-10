// Helper reusable untuk export laporan ke PDF & Excel, dipakai di modul
// Keuangan, Presensi, Generus, dan Kegiatan. Semua export mengikuti data yang
// SUDAH difilter/di-scope di halaman pemanggil (helper ini tidak melakukan
// query/scope sendiri) -- supaya export selalu konsisten dengan apa yang
// sedang dilihat user di layar.
'use client'

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'
import { GENSITI_LOGO_BASE64, PPG_LOGO_BASE64 } from './logo'

export interface ExportColumn {
  header: string
  key: string
  // Lebar kolom untuk Excel (dalam karakter, opsional)
  width?: number
}

export interface ExportOptions {
  // Judul laporan, contoh: "Laporan Keuangan"
  title: string
  // Sub-judul/scope, contoh: "Kelompok Bekasi Timur 1 -- Jan-Jun 2026"
  subtitle?: string
  columns: ExportColumn[]
  rows: Record<string, string | number>[]
  // Baris ringkasan opsional di akhir (misal Total Pemasukan/Pengeluaran/Saldo)
  summary?: { label: string; value: string }[]
  // Nama file tanpa ekstensi
  fileName: string
}

// Satu bagian/tabel di dalam laporan multi-bagian (mis. Laporan Bulanan Daerah: rekap
// kehadiran per Desa, breakdown kelas ngaji, tren 12 bulan -- tiga tabel berbeda struktur
// kolom dalam SATU laporan). Beda dari ExportOptions yang selalu satu tabel flat.
export interface ExportSection {
  // Judul bagian, dicetak sebagai sub-heading di atas tabelnya, contoh: "Rekap Kehadiran per Desa"
  heading: string
  columns: ExportColumn[]
  rows: Record<string, string | number>[]
  summary?: { label: string; value: string }[]
}

export interface MultiSectionExportOptions {
  title: string
  subtitle?: string
  sections: ExportSection[]
  fileName: string
}

const ORG_NAME = 'KMM Bekasi Timur'
const APP_NAME = 'GENSITI - Smart Organization Management System'

function formatTanggalCetak() {
  return new Date().toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Membangun dokumen jsPDF dari ExportOptions -- diekstrak dari exportToPDF supaya bisa
// dipakai ulang baik untuk disimpan langsung (doc.save) maupun untuk pratinjau (data URL
// di iframe, lihat getPdfPreviewDataUrl) tanpa duplikasi logika layout/kop/tabel/footer.
function buildPdfDoc(opts: ExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: opts.columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // Kop laporan -- logo PPG (organisasi induk) & GENSITI ditempel berdampingan di kiri
  // atas, teks org/app name tetap center supaya rapi walau ada logo. addImage dibungkus
  // try/catch: kalau base64 gagal dirender karena alasan apapun, laporan tetap tercetak
  // tanpa logo daripada gagal total.
  try {
    doc.addImage(PPG_LOGO_BASE64, 'PNG', 14, 8, 14, 14)
    doc.addImage(GENSITI_LOGO_BASE64, 'PNG', 30, 8, 14, 14)
  } catch {
    // non-fatal -- lanjut tanpa logo
  }
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(ORG_NAME, pageWidth / 2, 15, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(APP_NAME, pageWidth / 2, 21, { align: 'center' })
  doc.setLineWidth(0.5)
  doc.line(14, 25, pageWidth - 14, 25)

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.title, pageWidth / 2, 33, { align: 'center' })
  if (opts.subtitle) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(opts.subtitle, pageWidth / 2, 39, { align: 'center' })
  }

  autoTable(doc, {
    startY: opts.subtitle ? 44 : 38,
    head: [opts.columns.map(c => c.header)],
    body: opts.rows.map(row => opts.columns.map(c => String(row[c.key] ?? '-'))),
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    margin: { left: 14, right: 14 },
  })

  // Ringkasan setelah tabel (kalau ada)
  if (opts.summary && opts.summary.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let y = (doc as any).lastAutoTable.finalY + 8
    doc.setFontSize(9)
    opts.summary.forEach(s => {
      doc.setFont('helvetica', 'normal')
      doc.text(s.label, pageWidth - 70, y)
      doc.setFont('helvetica', 'bold')
      doc.text(s.value, pageWidth - 14, y, { align: 'right' })
      y += 6
    })
  }

  // Footer: tanggal cetak
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(
      `Dicetak: ${formatTanggalCetak()} -- Halaman ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    )
  }

  return doc
}

export function exportToPDF(opts: ExportOptions) {
  const doc = buildPdfDoc(opts)
  doc.save(`${opts.fileName}.pdf`)
}

// Versi multi-bagian dari buildPdfDoc -- satu dokumen PDF berisi beberapa tabel berbeda
// struktur berurutan (dipisah sub-heading), dipakai utk laporan yang secara alami tidak bisa
// digambarkan sebagai satu tabel flat (mis. Laporan Bulanan Daerah). Kop laporan sama persis
// dgn buildPdfDoc (logo, nama organisasi, judul/subtitle) supaya konsisten dgn laporan lain.
function buildMultiSectionPdfDoc(opts: MultiSectionExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm' })
  const pageWidth = doc.internal.pageSize.getWidth()

  try {
    doc.addImage(PPG_LOGO_BASE64, 'PNG', 14, 8, 14, 14)
    doc.addImage(GENSITI_LOGO_BASE64, 'PNG', 30, 8, 14, 14)
  } catch {
    // non-fatal -- lanjut tanpa logo
  }
  doc.setFontSize(14)
  doc.setFont('helvetica', 'bold')
  doc.text(ORG_NAME, pageWidth / 2, 15, { align: 'center' })
  doc.setFontSize(9)
  doc.setFont('helvetica', 'normal')
  doc.text(APP_NAME, pageWidth / 2, 21, { align: 'center' })
  doc.setLineWidth(0.5)
  doc.line(14, 25, pageWidth - 14, 25)

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.text(opts.title, pageWidth / 2, 33, { align: 'center' })
  if (opts.subtitle) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.text(opts.subtitle, pageWidth / 2, 39, { align: 'center' })
  }

  let cursorY = opts.subtitle ? 46 : 40

  opts.sections.forEach(section => {
    // Halaman baru kalau sisa ruang terlalu sempit utk heading + minimal beberapa baris tabel
    // (bukan dihitung presisi -- cukup pengaman kasar supaya heading tidak nyangkut sendirian
    // di baris terakhir sebuah halaman).
    if (cursorY > doc.internal.pageSize.getHeight() - 40) {
      doc.addPage()
      cursorY = 20
    }

    doc.setFontSize(10)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(30)
    doc.text(section.heading, 14, cursorY)
    cursorY += 4

    autoTable(doc, {
      startY: cursorY,
      head: [section.columns.map(c => c.header)],
      body: section.rows.map(row => section.columns.map(c => String(row[c.key] ?? '-'))),
      styles: { fontSize: 7.5, cellPadding: 1.5 },
      headStyles: { fillColor: [37, 99, 235], textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      margin: { left: 14, right: 14 },
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cursorY = (doc as any).lastAutoTable.finalY + 4

    if (section.summary && section.summary.length > 0) {
      doc.setFontSize(8)
      section.summary.forEach(s => {
        doc.setFont('helvetica', 'normal')
        doc.text(s.label, pageWidth - 80, cursorY)
        doc.setFont('helvetica', 'bold')
        doc.text(s.value, pageWidth - 14, cursorY, { align: 'right' })
        cursorY += 5
      })
    }

    cursorY += 8
  })

  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(
      `Dicetak: ${formatTanggalCetak()} -- Halaman ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    )
  }

  return doc
}

export function exportMultiSectionToPDF(opts: MultiSectionExportOptions) {
  const doc = buildMultiSectionPdfDoc(opts)
  doc.save(`${opts.fileName}.pdf`)
}

export function getMultiSectionPdfPreviewDataUrl(opts: MultiSectionExportOptions): string {
  const doc = buildMultiSectionPdfDoc(opts)
  return doc.output('datauristring')
}

// Excel multi-bagian: SATU sheet berisi semua bagian berurutan (bukan sheet terpisah per
// bagian) -- lebih sederhana dibuka & dibaca sekali jalan dibanding harus pindah-pindah tab,
// dan cukup utk kebutuhan laporan ini (beda dari file Excel manual PPG yang sheet-per-Desa
// krn itu dirancang utk proses ISI MANUAL per Desa, bukan sekadar laporan hasil akhir).
export async function exportMultiSectionToExcel(opts: MultiSectionExportOptions) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = APP_NAME
  workbook.created = new Date()

  const safeSheetName = (opts.title.replace(/[*?:\\/[\]]/g, '-').trim().slice(0, 31)) || 'Laporan'
  const sheet = workbook.addWorksheet(safeSheetName)

  const maxCols = Math.max(1, ...opts.sections.map(s => s.columns.length))

  try {
    const ppgImageId = workbook.addImage({ base64: PPG_LOGO_BASE64, extension: 'png' })
    sheet.addImage(ppgImageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 34, height: 34 } })
    const gensitiImageId = workbook.addImage({ base64: GENSITI_LOGO_BASE64, extension: 'png' })
    sheet.addImage(gensitiImageId, { tl: { col: 0.95, row: 0.1 }, ext: { width: 34, height: 34 } })
    sheet.getRow(1).height = 26
  } catch {
    // non-fatal -- lanjut tanpa logo
  }
  sheet.addRow([])

  sheet.mergeCells(2, 1, 2, maxCols)
  sheet.getCell(2, 1).value = ORG_NAME
  sheet.getCell(2, 1).font = { bold: true, size: 14 }
  sheet.getCell(2, 1).alignment = { horizontal: 'center' }

  sheet.mergeCells(3, 1, 3, maxCols)
  sheet.getCell(3, 1).value = opts.title + (opts.subtitle ? ` -- ${opts.subtitle}` : '')
  sheet.getCell(3, 1).font = { bold: true, size: 11 }
  sheet.getCell(3, 1).alignment = { horizontal: 'center' }

  opts.sections.forEach(section => {
    sheet.addRow([])
    const headingRow = sheet.addRow([section.heading])
    headingRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF1D4ED8' } }

    const headerRow = sheet.addRow(section.columns.map(c => c.header))
    headerRow.eachCell(cell => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
      cell.alignment = { horizontal: 'center' }
    })

    section.rows.forEach(row => {
      sheet.addRow(section.columns.map(c => row[c.key] ?? '-'))
    })

    if (section.summary && section.summary.length > 0) {
      sheet.addRow([])
      section.summary.forEach(s => {
        const r = sheet.addRow([s.label])
        r.getCell(1).font = { bold: true }
        sheet.getCell(r.number, section.columns.length).value = s.value
        sheet.getCell(r.number, section.columns.length).font = { bold: true }
      })
    }
  })

  for (let i = 1; i <= maxCols; i++) {
    sheet.getColumn(i).width = 18
  }

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Menghasilkan data URL (base64) dari PDF yang PERSIS sama dengan hasil exportToPDF --
// dipakai untuk pratinjau di <iframe>/<embed> sebelum user menekan tombol export final,
// supaya yang dilihat user benar-benar preview dari file yang akan diunduh (bukan tiruan
// terpisah yang bisa saja berbeda hasil akhirnya).
export function getPdfPreviewDataUrl(opts: ExportOptions): string {
  const doc = buildPdfDoc(opts)
  return doc.output('datauristring')
}

export async function exportToExcel(opts: ExportOptions) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = APP_NAME
  workbook.created = new Date()

  // Nama worksheet Excel tidak boleh mengandung karakter * ? : \ / [ ] dan maks. 31 karakter
  // (batasan format .xlsx, bukan batasan ExcelJS) -- judul laporan seperti "Daftar Generus /
  // Pengguna" harus disanitasi dulu, kalau tidak addWorksheet() akan throw exception.
  const safeSheetName = (opts.title.replace(/[*?:\\/[\]]/g, '-').trim().slice(0, 31)) || 'Laporan'
  const sheet = workbook.addWorksheet(safeSheetName)

  // Kop -- baris 1 dikhususkan untuk logo PPG & GENSITI berdampingan (kolom A-B) supaya
  // tidak menimpa teks org/app name yang di-merge & center di baris 2-3 (baris judul
  // digeser turun 1 dibanding sebelumnya). Row 1 dibuat pendek/kosong secara teks, hanya
  // berisi gambar mengambang. Dibungkus try/catch: kalau addImage gagal karena alasan
  // apapun, laporan tetap ter-generate tanpa logo daripada gagal total.
  try {
    const ppgImageId = workbook.addImage({ base64: PPG_LOGO_BASE64, extension: 'png' })
    sheet.addImage(ppgImageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 34, height: 34 } })
    const gensitiImageId = workbook.addImage({ base64: GENSITI_LOGO_BASE64, extension: 'png' })
    sheet.addImage(gensitiImageId, { tl: { col: 0.95, row: 0.1 }, ext: { width: 34, height: 34 } })
    sheet.getRow(1).height = 26
  } catch {
    // non-fatal -- lanjut tanpa logo
  }
  sheet.addRow([])

  sheet.mergeCells(2, 1, 2, opts.columns.length)
  sheet.getCell(2, 1).value = ORG_NAME
  sheet.getCell(2, 1).font = { bold: true, size: 14 }
  sheet.getCell(2, 1).alignment = { horizontal: 'center' }

  sheet.mergeCells(3, 1, 3, opts.columns.length)
  sheet.getCell(3, 1).value = opts.title + (opts.subtitle ? ` -- ${opts.subtitle}` : '')
  sheet.getCell(3, 1).font = { bold: true, size: 11 }
  sheet.getCell(3, 1).alignment = { horizontal: 'center' }

  sheet.addRow([])

  // Header kolom
  const headerRow = sheet.addRow(opts.columns.map(c => c.header))
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }
    cell.alignment = { horizontal: 'center' }
  })

  // Data
  opts.rows.forEach(row => {
    sheet.addRow(opts.columns.map(c => row[c.key] ?? '-'))
  })

  // Ringkasan
  if (opts.summary && opts.summary.length > 0) {
    sheet.addRow([])
    opts.summary.forEach(s => {
      const r = sheet.addRow([s.label])
      r.getCell(1).font = { bold: true }
      sheet.getCell(r.number, opts.columns.length).value = s.value
      sheet.getCell(r.number, opts.columns.length).font = { bold: true }
    })
  }

  // Lebar kolom
  opts.columns.forEach((c, i) => {
    sheet.getColumn(i + 1).width = c.width || 18
  })

  const buffer = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${opts.fileName}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
