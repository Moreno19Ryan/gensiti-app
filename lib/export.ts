// Helper reusable untuk export laporan ke PDF & Excel, dipakai di modul
// Keuangan, Presensi, Anggota, dan Kegiatan. Semua export mengikuti data yang
// SUDAH difilter/di-scope di halaman pemanggil (helper ini tidak melakukan
// query/scope sendiri) -- supaya export selalu konsisten dengan apa yang
// sedang dilihat user di layar.
'use client'

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import ExcelJS from 'exceljs'
import { RYZA_LOGO_BASE64 } from './logo'

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

const ORG_NAME = 'KMM Bekasi Timur'
const APP_NAME = 'RYZA - Smart Organization Management System'

function formatTanggalCetak() {
  return new Date().toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export function exportToPDF(opts: ExportOptions) {
  const doc = new jsPDF({ orientation: opts.columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm' })
  const pageWidth = doc.internal.pageSize.getWidth()

  // Kop laporan -- logo RYZA ditempel di kiri atas, teks org/app name tetap center
  // supaya rapi walau ada logo. addImage dibungkus try/catch: kalau base64 gagal
  // dirender karena alasan apapun, laporan tetap tercetak tanpa logo daripada gagal total.
  try {
    doc.addImage(RYZA_LOGO_BASE64, 'PNG', 14, 8, 14, 14)
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

  doc.save(`${opts.fileName}.pdf`)
}

export async function exportToExcel(opts: ExportOptions) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = APP_NAME
  workbook.created = new Date()

  // Nama worksheet Excel tidak boleh mengandung karakter * ? : \ / [ ] dan maks. 31 karakter
  // (batasan format .xlsx, bukan batasan ExcelJS) -- judul laporan seperti "Daftar Anggota /
  // Pengguna" harus disanitasi dulu, kalau tidak addWorksheet() akan throw exception.
  const safeSheetName = (opts.title.replace(/[*?:\\/[\]]/g, '-').trim().slice(0, 31)) || 'Laporan'
  const sheet = workbook.addWorksheet(safeSheetName)

  // Kop -- baris 1 dikhususkan untuk logo RYZA (kolom A) supaya tidak menimpa teks org/app
  // name yang di-merge & center di baris 2-3 (baris judul digeser turun 1 dibanding
  // sebelumnya). Row 1 dibuat pendek/kosong secara teks, hanya berisi gambar mengambang.
  // Dibungkus try/catch: kalau addImage gagal karena alasan apapun, laporan tetap
  // ter-generate tanpa logo daripada gagal total.
  try {
    const imageId = workbook.addImage({ base64: RYZA_LOGO_BASE64, extension: 'png' })
    sheet.addImage(imageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 34, height: 34 } })
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
