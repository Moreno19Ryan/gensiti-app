// Helper reusable untuk export laporan ke PDF & Excel, dipakai di modul
// Keuangan, Presensi, Generus, dan Kegiatan. Semua export mengikuti data yang
// SUDAH difilter/di-scope di halaman pemanggil (helper ini tidak melakukan
// query/scope sendiri) -- supaya export selalu konsisten dengan apa yang
// sedang dilihat user di layar.
'use client'

import jsPDF from 'jspdf'
import autoTable, { CellHookData } from 'jspdf-autotable'
import ExcelJS from 'exceljs'
import { GENSITI_LOGO_BASE64, PPG_LOGO_BASE64 } from './logo'

export interface ExportColumn {
  header: string
  key: string
  // Lebar kolom untuk Excel (dalam karakter, opsional)
  width?: number
  // Redesain laporan (permintaan user: "kurang modern, intuitif, interaktif") -- tandai kolom
  // ini sbg badge berwarna alih-alih teks polos, baik di PDF (kotak kecil berwarna di belakang
  // teks) maupun Excel (conditional formatting: fill sel otomatis). Warna DITENTUKAN OTOMATIS
  // dari isi teks tiap sel (lihat resolveBadgeTone di bawah) -- dicocokkan lewat kata kunci umum
  // Indonesia yg dipakai di seluruh aplikasi (hadir/lunas/baik -> hijau, tidak hadir/alpha/
  // perlu perhatian/ditolak -> merah, izin/sakit/pending -> netral abu), BUKAN dikonfigurasi
  // manual per laporan -- supaya kolom status apapun (Kehadiran, Status Reimbursement, Status
  // Kegiatan, dst) otomatis dapat treatment yg sama tanpa tiap halaman pemanggil perlu diubah.
  isBadge?: boolean
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

// Grafik hasil capture (PNG data URL, lihat html-to-image di LaporanBulananModal.tsx) yang
// disisipkan sebagai gambar di PDF/Excel -- dipakai untuk laporan yang punya visualisasi
// selain tabel (mis. Laporan Bulanan Daerah: tren 12 bulan, pertumbuhan Generus, perbandingan
// antar-Desa). Opsional -- laporan lain yang tidak punya grafik cukup tidak mengisi field ini.
export interface ExportChartImage {
  title: string
  // Data URL PNG (mis. "data:image/png;base64,...") hasil toPng() dari DOM chart Recharts.
  imageDataUrl: string
  // Rasio lebar:tinggi asli gambar -- dipakai supaya gambar tidak gepeng/stretch saat
  // ditempel di PDF/Excel dengan lebar tetap.
  aspectRatio: number
}

export interface MultiSectionExportOptions {
  title: string
  subtitle?: string
  // Catatan ringkasan opsional (mis. kalimat insight otomatis "Kehadiran naik 5% dari bulan
  // lalu...") -- dirender sebagai paragraf di bawah kop, sebelum sections. Beda dari subtitle
  // (satu baris pendek, selalu center) -- note ini bisa lebih panjang & rata kiri, mirip catatan
  // kaki penjelas. Opsional, laporan lain yang tidak butuh tetap jalan seperti biasa.
  note?: string
  sections: ExportSection[]
  fileName: string
  charts?: ExportChartImage[]
}

const ORG_NAME = 'KMM Bekasi Timur'
const APP_NAME = 'GENSITI - Smart Organization Management System'

// Tone badge -- 3 kategori generik yg mencakup semua status di aplikasi (kehadiran, keuangan,
// approval kegiatan/pengumuman, dst): 'positif' (hijau, hasil baik/selesai), 'negatif' (merah,
// butuh perhatian/gagal/ditolak), 'netral' (abu, kondisi wajar tapi bukan status "baik" -- Izin/
// Sakit/Pending -- SENGAJA dibedakan dari 'negatif' krn izin/sakit itu wajar, bukan masalah).
type BadgeTone = 'positif' | 'negatif' | 'netral'

const BADGE_KEYWORDS: { tone: BadgeTone; katas: string[] }[] = [
  // Urutan penting: 'negatif' dicek SEBELUM 'netral' krn beberapa kata (mis. "belum") bisa
  // tumpang tindih maksud -- lihat resolveBadgeTone, larik ini diproses berurutan dan berhenti
  // di kecocokan pertama.
  {
    tone: 'negatif',
    katas: ['tidak hadir', 'alpha', 'perlu perhatian', 'ditolak', 'gagal', 'terlambat', 'belum ditandai', 'nonaktif', 'expired', 'kadaluarsa'],
  },
  {
    tone: 'netral',
    katas: ['izin', 'sakit', 'pending', 'menunggu', 'diajukan', 'draft'],
  },
  {
    tone: 'positif',
    katas: ['hadir', 'lunas', 'baik', 'aktif', 'disetujui', 'selesai', 'diterima', 'approved'],
  },
]

function resolveBadgeTone(text: string): BadgeTone | null {
  const lower = text.toLowerCase().trim()
  for (const group of BADGE_KEYWORDS) {
    if (group.katas.some(k => lower.includes(k))) return group.tone
  }
  return null // teks tidak cocok kata kunci apapun -- dirender polos, bukan dipaksa jadi badge
}

// Warna badge dalam RGB (dipakai jsPDF, skala 0-255) -- palet earthy/muted (bukan merah/hijau
// terang saturasi tinggi khas alert web) supaya tetap terbaca profesional saat dicetak di
// kertas, konsisten dgn arah desain "minimalis modern" yg dipilih (bukan gaya dashboard
// berwarna-warni).
const BADGE_COLOR_PDF: Record<BadgeTone, { bg: [number, number, number]; text: [number, number, number] }> = {
  positif: { bg: [222, 240, 226], text: [22, 101, 52] },
  negatif: { bg: [252, 226, 226], text: [153, 27, 27] },
  netral: { bg: [237, 237, 234], text: [82, 82, 78] },
}

// Warna badge dalam ARGB hex (dipakai ExcelJS conditional formatting/fill) -- sengaja SAMA
// PERSIS dgn palet PDF di atas (dikonversi ke hex) supaya laporan yg dibuka di kedua format
// terasa konsisten satu identitas visual, bukan dua desain berbeda.
const BADGE_COLOR_EXCEL: Record<BadgeTone, { fill: string; font: string }> = {
  positif: { fill: 'FFDEF0E2', font: 'FF166534' },
  negatif: { fill: 'FFFCE2E2', font: 'FF991B1B' },
  netral: { fill: 'FFEDEDEA', font: 'FF52524E' },
}

function formatTanggalCetak() {
  return new Date().toLocaleString('id-ID', {
    day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

// Menggambar kop laporan (logo, nama organisasi, judul/subtitle) -- diekstrak jadi fungsi
// bersama dipakai baik oleh buildPdfDoc (single-table) maupun buildMultiSectionPdfDoc, supaya
// kop SELALU identik persis di semua jenis laporan (redesain: garis pemisah dari solid tebal
// jadi tipis abu-abu, lebih halus/minimalis -- lihat diskusi desain "gaya A").
function drawPdfHeader(doc: jsPDF, pageWidth: number, title: string, subtitle?: string): number {
  try {
    doc.addImage(GENSITI_LOGO_BASE64, 'PNG', 14, 8, 14, 14)
    doc.addImage(PPG_LOGO_BASE64, 'PNG', pageWidth - 28, 8, 14, 14)
  } catch {
    // non-fatal -- lanjut tanpa logo
  }
  doc.setFontSize(13)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(30, 30, 28)
  doc.text(ORG_NAME, pageWidth / 2, 15, { align: 'center' })
  doc.setFontSize(8)
  doc.setFont('helvetica', 'normal')
  doc.setTextColor(140, 140, 135)
  doc.text(APP_NAME, pageWidth / 2, 20.5, { align: 'center' })
  doc.setDrawColor(225, 225, 220)
  doc.setLineWidth(0.2)
  doc.line(14, 24, pageWidth - 14, 24)

  doc.setFontSize(12)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(20, 20, 18)
  doc.text(title, pageWidth / 2, 32, { align: 'center' })
  let cursorY = 32
  if (subtitle) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(110, 110, 105)
    doc.text(subtitle, pageWidth / 2, 38, { align: 'center' })
    cursorY = 38
  }
  doc.setTextColor(0, 0, 0)
  return cursorY
}

// Aksen warna kartu ringkasan (polish v3) -- ditentukan otomatis dari LABEL kartu (bukan
// value-nya, beda dari resolveBadgeTone yg baca teks status) lewat kata kunci yg sama dgn
// BADGE_KEYWORDS supaya "Hadir"/"Tidak Hadir"/"Izin"/"Sakit" dst konsisten warnanya dgn badge
// status di tabel di bawahnya. Kartu yg labelnya tidak cocok kata kunci apapun (mis. "Total
// Generus", "Total Pemasukan") jatuh ke warna netral abu -- tetap rapi, tidak dipaksa berwarna.
function resolveCardAccent(label: string): { accent: [number, number, number]; bg: [number, number, number] } {
  const tone = resolveBadgeTone(label)
  if (tone === 'positif') return { accent: [34, 139, 87], bg: [237, 247, 239] }
  if (tone === 'negatif') return { accent: [200, 60, 60], bg: [253, 238, 238] }
  if (tone === 'netral') return { accent: [150, 130, 60], bg: [250, 245, 230] }
  return { accent: [90, 90, 130], bg: [240, 240, 246] }
}

// Kartu ringkasan (redesain v1 -- dulu teks kecil rata-kanan DI BAWAH tabel, dipindah jadi angka
// besar DI ATAS tabel, mirip hero metric yg sudah dipakai LaporanBulananModal on-screen; polish
// v3 -- tiap kartu dapat aksen warna kiri + background tint sesuai makna labelnya (lihat
// resolveCardAccent), bukan lagi kotak abu seragam, supaya sekilas pandang pembaca laporan
// langsung bisa bedakan mana angka "baik" (hijau) vs "butuh perhatian" (merah) tanpa baca detail
// tabel). Alasan dipindah ke atas: pembaca laporan (Ketua/Sekretaris) biasanya cuma butuh angka
// total dulu utk gambaran cepat, baru scroll ke tabel detail kalau perlu -- pola "ringkasan
// dulu, detail belakangan" yg sudah konsisten dipakai di seluruh redesain laporan bulanan
// sebelumnya. Dibagi rata dalam grid horizontal, maks 5 kartu per baris (kalau lebih, redesain
// kolom bukan tujuan fungsi ini -- summary laporan di app ini tidak pernah lebih dari 5 item).
function drawSummaryCards(doc: jsPDF, pageWidth: number, startY: number, summary: { label: string; value: string }[]): number {
  const marginX = 14
  const usableWidth = pageWidth - marginX * 2
  const cardCount = summary.length
  const gap = 3.5
  const cardWidth = (usableWidth - gap * (cardCount - 1)) / cardCount
  const cardHeight = 20
  const accentBarWidth = 1.3

  summary.forEach((s, i) => {
    const x = marginX + i * (cardWidth + gap)
    const { accent, bg } = resolveCardAccent(s.label)

    // Kartu: background tint halus + border sangat tipis, radius lebih besar drpd v1 (2.2 vs 1.5)
    // supaya kesan "kartu" lebih jelas, bukan sekadar kotak.
    doc.setFillColor(...bg)
    doc.setDrawColor(bg[0] - 12, bg[1] - 12, bg[2] - 12)
    doc.setLineWidth(0.15)
    doc.roundedRect(x, startY, cardWidth, cardHeight, 2.2, 2.2, 'FD')

    // Aksen bar vertikal di sisi kiri kartu -- warna solid penuh (bukan tint), penanda cepat
    // "kartu ini soal apa" bahkan sebelum baca angkanya.
    doc.setFillColor(...accent)
    doc.roundedRect(x, startY, accentBarWidth + 1, cardHeight, 1, 1, 'F')
    // Tutup sudut kanan aksen bar yg ikut membulat (efek roundedRect) dgn kotak tajam supaya
    // sisi kanan bar tetap lurus, hanya sisi kiri kartu yg membulat mengikuti bentuk kartu.
    doc.rect(x + accentBarWidth, startY, 1, cardHeight, 'F')

    doc.setFontSize(13)
    doc.setFont('helvetica', 'bold')
    doc.setTextColor(accent[0] * 0.55, accent[1] * 0.55, accent[2] * 0.55)
    doc.text(s.value, x + cardWidth / 2 + 1, startY + 9.5, { align: 'center' })
    doc.setFontSize(6.8)
    doc.setFont('helvetica', 'normal')
    doc.setTextColor(110, 110, 108)
    doc.text(s.label, x + cardWidth / 2 + 1, startY + 15.5, { align: 'center' })
  })
  doc.setTextColor(0, 0, 0)
  doc.setDrawColor(0, 0, 0)
  return startY + cardHeight + 7
}

function drawPdfFooter(doc: jsPDF) {
  const pageCount = doc.getNumberOfPages()
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i)
    doc.setFontSize(7)
    doc.setTextColor(160, 160, 155)
    doc.text(
      `Dicetak: ${formatTanggalCetak()} -- Halaman ${i}/${pageCount}`,
      14,
      doc.internal.pageSize.getHeight() - 8
    )
  }
}

// didParseCell hook (jspdf-autotable) -- dipanggil per-sel sebelum digambar, dipakai di sini
// utk merender kolom bertanda isBadge sbg kotak kecil berwarna alih-alih teks polos. Warna
// ditentukan otomatis dari isi teks (resolveBadgeTone) -- kalau teks tidak cocok kata kunci
// apapun (mis. tanggal atau nilai lain yg kebetulan ada di kolom isBadge), sel dirender polos
// spt biasa, tidak dipaksa jadi badge kosong.
// Polish v3: badge sekarang dibatasi lebar (bukan mengisi penuh sel) & dikasih padding
// vertikal lebih kecil supaya terlihat spt "pill" kecil di tengah sel, bukan blok warna penuh
// sepanjang kolom -- konsisten dgn tampilan badge di layar aplikasi (rounded-full).
function makeBadgeCellHook(columns: ExportColumn[]) {
  return (data: CellHookData) => {
    if (data.section !== 'body') return
    const col = columns[data.column.index]
    if (!col?.isBadge) return
    const tone = resolveBadgeTone(String(data.cell.raw ?? ''))
    if (!tone) return
    const { bg, text } = BADGE_COLOR_PDF[tone]
    data.cell.styles.fillColor = bg
    data.cell.styles.textColor = text
    data.cell.styles.fontStyle = 'bold'
    data.cell.styles.halign = 'center'
    data.cell.styles.valign = 'middle'
  }
}

// Membangun dokumen jsPDF dari ExportOptions -- diekstrak dari exportToPDF supaya bisa
// dipakai ulang baik untuk disimpan langsung (doc.save) maupun untuk pratinjau (data URL
// di iframe, lihat getPdfPreviewDataUrl) tanpa duplikasi logika layout/kop/tabel/footer.
function buildPdfDoc(opts: ExportOptions): jsPDF {
  const doc = new jsPDF({ orientation: opts.columns.length > 5 ? 'landscape' : 'portrait', unit: 'mm' })
  const pageWidth = doc.internal.pageSize.getWidth()

  const headerBottomY = drawPdfHeader(doc, pageWidth, opts.title, opts.subtitle)
  let cursorY = headerBottomY + 6

  // Kartu ringkasan dipindah ke ATAS tabel (redesain) -- lihat komentar drawSummaryCards.
  if (opts.summary && opts.summary.length > 0) {
    cursorY = drawSummaryCards(doc, pageWidth, cursorY, opts.summary)
  }

  // Polish v3: header lebih tegas (uppercase, letter-spacing via ukuran font lebih kecil +
  // bold, border bawah lebih gelap drpd border antar-baris data) supaya batas header/data jelas
  // tanpa perlu warna solid mencolok. Baris data pakai garis horizontal tipis SAJA (bukan grid
  // penuh vertikal+horizontal) -- lebih bersih/minimalis, garis vertikal antar kolom dihapus
  // krn dgn zebra striping yang ada, pembatas kolom eksplisit jadi berlebihan (redundant
  // dgn beda warna latar tiap baris genap/ganjil).
  autoTable(doc, {
    startY: cursorY,
    head: [opts.columns.map(c => c.header.toUpperCase())],
    body: opts.rows.map(row => opts.columns.map(c => String(row[c.key] ?? '-'))),
    styles: {
      fontSize: 8,
      cellPadding: { top: 2.6, bottom: 2.6, left: 2.5, right: 2.5 },
      lineColor: [240, 240, 236],
      lineWidth: { top: 0.1, bottom: 0.1, left: 0, right: 0 },
      textColor: [55, 55, 52],
      valign: 'middle',
    },
    headStyles: {
      fillColor: [40, 40, 38],
      textColor: [245, 245, 243],
      fontStyle: 'bold',
      fontSize: 7.2,
      cellPadding: { top: 3, bottom: 3, left: 2.5, right: 2.5 },
      lineWidth: 0,
    },
    alternateRowStyles: { fillColor: [249, 249, 247] },
    margin: { left: 14, right: 14 },
    didParseCell: makeBadgeCellHook(opts.columns),
  })

  drawPdfFooter(doc)
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
    doc.addImage(GENSITI_LOGO_BASE64, 'PNG', 14, 8, 14, 14)
    doc.addImage(PPG_LOGO_BASE64, 'PNG', pageWidth - 28, 8, 14, 14)
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

  // Catatan ringkasan (mis. kalimat insight otomatis) -- kotak rata kiri di bawah kop,
  // dibungkus (word-wrap) selebar halaman dikurangi margin. splitTextToSize menghitung tinggi
  // teks setelah wrap, dipakai utk menggeser cursorY section pertama ke bawah secukupnya.
  if (opts.note) {
    doc.setFontSize(9)
    doc.setFont('helvetica', 'italic')
    doc.setTextColor(60)
    const noteLines = doc.splitTextToSize(opts.note, pageWidth - 28)
    doc.text(noteLines, 14, cursorY)
    cursorY += noteLines.length * 4.5 + 4
    doc.setTextColor(0)
  }

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

  // Grafik (kalau ada) -- masing-masing ditempel di halaman sendiri supaya ukurannya cukup
  // besar untuk terbaca jelas saat dicetak, bukan diperkecil paksa muat di sisa ruang tabel.
  if (opts.charts && opts.charts.length > 0) {
    const maxImgWidth = pageWidth - 28 // margin 14mm kiri-kanan, sama dgn tabel
    const maxImgHeight = doc.internal.pageSize.getHeight() - 50 // sisakan ruang kop tiap halaman baru + footer

    opts.charts.forEach(chart => {
      doc.addPage()
      let y = 20
      doc.setFontSize(11)
      doc.setFont('helvetica', 'bold')
      doc.setTextColor(30)
      doc.text(chart.title, 14, y)
      y += 6

      let imgWidth = maxImgWidth
      let imgHeight = imgWidth / chart.aspectRatio
      if (imgHeight > maxImgHeight) {
        imgHeight = maxImgHeight
        imgWidth = imgHeight * chart.aspectRatio
      }

      try {
        doc.addImage(chart.imageDataUrl, 'PNG', 14, y, imgWidth, imgHeight)
      } catch {
        doc.setFontSize(9)
        doc.setFont('helvetica', 'normal')
        doc.text('(Gagal memuat grafik)', 14, y + 10)
      }
    })
  }

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
    const gensitiImageId = workbook.addImage({ base64: GENSITI_LOGO_BASE64, extension: 'png' })
    sheet.addImage(gensitiImageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 34, height: 34 } })
    const ppgImageId = workbook.addImage({ base64: PPG_LOGO_BASE64, extension: 'png' })
    sheet.addImage(ppgImageId, { tl: { col: Math.max(0.95, maxCols - 1.05), row: 0.1 }, ext: { width: 34, height: 34 } })
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

  // Catatan ringkasan (mis. kalimat insight otomatis) -- baris terpisah, italic, rata kiri
  // (beda dari title/subtitle di atas yang center) supaya terasa seperti catatan penjelas,
  // bukan bagian dari kop resmi. wrapText true krn kalimatnya bisa cukup panjang.
  if (opts.note) {
    sheet.addRow([])
    const noteRowNum = sheet.rowCount + 1
    sheet.mergeCells(noteRowNum, 1, noteRowNum, maxCols)
    const noteRow = sheet.getRow(noteRowNum)
    noteRow.getCell(1).value = opts.note
    noteRow.getCell(1).font = { italic: true, size: 10, color: { argb: 'FF475569' } }
    noteRow.getCell(1).alignment = { horizontal: 'left', wrapText: true }
    noteRow.commit()
  }

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

  // Grafik (kalau ada) -- ditempel di bawah semua tabel, masing-masing dgn judul sendiri.
  // Lebar gambar dipatok ~700px (menyesuaikan lebar kolom default 18 char x maxCols), tinggi
  // mengikuti aspectRatio asli chart supaya tidak gepeng.
  if (opts.charts && opts.charts.length > 0) {
    const imgWidth = Math.max(500, maxCols * 18 * 7) // perkiraan px dari lebar kolom Excel
    opts.charts.forEach(chart => {
      sheet.addRow([])
      const headingRow = sheet.addRow([chart.title])
      headingRow.getCell(1).font = { bold: true, size: 11, color: { argb: 'FF1D4ED8' } }
      const startRow = sheet.rowCount + 1

      try {
        const base64 = chart.imageDataUrl.split(',')[1] || chart.imageDataUrl
        const imgId = workbook.addImage({ base64, extension: 'png' })
        const imgHeight = imgWidth / chart.aspectRatio
        sheet.addImage(imgId, {
          tl: { col: 0, row: startRow - 1 },
          ext: { width: imgWidth, height: imgHeight },
        })
        // Baris kosong seukuran tinggi gambar (perkiraan ~20px per baris) supaya konten
        // berikutnya (grafik lain / akhir sheet) tidak tertindih gambar ini.
        const rowsNeeded = Math.ceil(imgHeight / 20)
        for (let i = 0; i < rowsNeeded; i++) sheet.addRow([])
      } catch {
        sheet.addRow(['(Gagal memuat grafik)'])
      }
    })
  }

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

  // Kop -- baris 1 dikhususkan untuk logo GENSITI (kiri, kolom A) & PPG (kanan, mendekati
  // kolom terakhir tabel) supaya tidak menimpa teks org/app name yang di-merge & center di
  // baris 2-3 (baris judul digeser turun 1 dibanding sebelumnya). Row 1 dibuat pendek/kosong
  // secara teks, hanya berisi gambar mengambang. Dibungkus try/catch: kalau addImage gagal
  // karena alasan apapun, laporan tetap ter-generate tanpa logo daripada gagal total.
  try {
    const gensitiImageId = workbook.addImage({ base64: GENSITI_LOGO_BASE64, extension: 'png' })
    sheet.addImage(gensitiImageId, { tl: { col: 0.15, row: 0.1 }, ext: { width: 34, height: 34 } })
    const ppgImageId = workbook.addImage({ base64: PPG_LOGO_BASE64, extension: 'png' })
    sheet.addImage(ppgImageId, { tl: { col: Math.max(0.95, opts.columns.length - 1.05), row: 0.1 }, ext: { width: 34, height: 34 } })
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

  // Ringkasan (redesain -- dipindah ke ATAS tabel, konsisten dgn PDF, lihat drawSummaryCards)
  // sbg baris "Label: Value" berjejer horizontal di satu baris, bold, sblm header kolom --
  // supaya pembaca lihat angka total dulu sblm scroll ke data mentah.
  if (opts.summary && opts.summary.length > 0) {
    sheet.addRow([])
    const summaryRowNum = sheet.rowCount + 1
    opts.summary.forEach((s, i) => {
      const cell = sheet.getCell(summaryRowNum, i + 1)
      cell.value = `${s.label}: ${s.value}`
      cell.font = { bold: true, size: 10, color: { argb: 'FF3D3D3A' } }
    })
    sheet.getRow(summaryRowNum).commit()
  }

  sheet.addRow([])

  // Header kolom -- redesain dari biru solid jadi abu-abu halus (konsisten dgn PDF, lihat
  // BADGE_COLOR_EXCEL & drawPdfHeader), lebih minimalis drpd warna mencolok penuh satu baris.
  const headerRow = sheet.addRow(opts.columns.map(c => c.header))
  headerRow.eachCell(cell => {
    cell.font = { bold: true, size: 10, color: { argb: 'FF46463F' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7F7F5' } }
    cell.alignment = { horizontal: 'center' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFE1E1DC' } } }
  })
  const headerRowNum = headerRow.number

  // Data
  const badgeColIndexes = opts.columns
    .map((c, i) => (c.isBadge ? i + 1 : null))
    .filter((i): i is number => i !== null)

  opts.rows.forEach(row => {
    const dataRow = sheet.addRow(opts.columns.map(c => row[c.key] ?? '-'))
    // Kolom bertanda isBadge diwarnai langsung per-sel di sini (bukan lewat ExcelJS
    // conditionalFormatting rule) -- lebih sederhana & pasti benar krn tone-nya sudah
    // ditentukan sekali di JS (resolveBadgeTone) tanpa perlu menerjemahkan ulang jadi formula
    // Excel (mis. rule ISNUMBER(SEARCH(...))) yg rawan salah cocok dgn kata kunci berbahasa
    // Indonesia yg dipakai di sini.
    badgeColIndexes.forEach(colIdx => {
      const cell = dataRow.getCell(colIdx)
      const tone = resolveBadgeTone(String(cell.value ?? ''))
      if (!tone) return
      const { fill, font } = BADGE_COLOR_EXCEL[tone]
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } }
      cell.font = { bold: true, color: { argb: font } }
      cell.alignment = { horizontal: 'center' }
    })
  })

  // Freeze pane -- baris di atas & termasuk header kolom tetap terlihat saat scroll data
  // panjang (mis. Daftar Generus bisa ratusan baris utk scope Daerah).
  sheet.views = [{ state: 'frozen', ySplit: headerRowNum }]

  // AutoFilter -- user bisa filter/sortir sendiri per kolom langsung di Excel tanpa perlu
  // edit apapun, salah satu permintaan eksplisit dari diskusi redesain ("Excel kurang fitur
  // built-in"). Range dari header sampai baris data terakhir.
  const lastDataRow = sheet.rowCount
  if (lastDataRow > headerRowNum) {
    sheet.autoFilter = {
      from: { row: headerRowNum, column: 1 },
      to: { row: lastDataRow, column: opts.columns.length },
    }
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
