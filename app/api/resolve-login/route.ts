import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint publik (dipanggil SEBELUM ada sesi Supabase, dari halaman login) untuk
// menerjemahkan "nama pengguna" yang diketik user menjadi email asli yang tersimpan di
// public.users.email -- email itu sendiri TETAP jadi identitas asli di Supabase Auth
// (dipakai signInWithPassword di client setelah endpoint ini merespons) dan tetap dipakai
// utuh oleh seluruh sistem notifikasi email (lihat trigger trg_notify_email_* di database),
// jadi tidak ada perubahan apapun pada alur notifikasi.
//
// Pakai service role karena RLS tabel users mengharuskan sesi aktif (autentikasi dulu),
// padahal endpoint ini justru dipanggil SEBELUM autentikasi terjadi. Untuk mencegah endpoint
// ini disalahgunakan sebagai celah enumerasi akun (menebak nama mana saja yang terdaftar),
// responsnya SENGAJA tidak membedakan "nama tidak ditemukan" vs "error lain" -- keduanya
// balik sebagai objek yang sama, dan HANYA field email yang pernah dikembalikan (bukan
// data profil lain).
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

// Meng-escape wildcard `%`/`_` (dan backslash sbg escape char-nya) sebelum dipakai di
// .ilike() -- endpoint ini publik/tanpa autentikasi, jadi `normalized` sepenuhnya input
// penyerang. Tanpa escape ini, mengetik "%" sebagai nama pengguna mencocokkan SEMUA user
// aktif dan mengembalikan email asli user pertama -- persis celah enumerasi akun yang
// ingin dicegah komentar di bawah, hanya lewat jalur pencarian nama_lengkap (bukan
// "tidak ditemukan").
function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

// Ambil IP client dari header proxy (Vercel mengisi x-forwarded-for). Dipangkas 45 char
// (cukup utk IPv6) supaya string yang dikendalikan penyerang tidak bisa menggelembungkan
// bucket_key. Fallback 'unknown' -- semua request tanpa IP terdeteksi berbagi satu bucket.
function getClientIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for') || ''
  const first = xff.split(',')[0]?.trim()
  const ip = first || req.headers.get('x-real-ip') || 'unknown'
  return ip.slice(0, 45)
}

// Rate limit per-IP untuk endpoint enumeration-sensitif ini (resolve-login mengembalikan
// email utk nama valid vs 404 utk tidak ada -- oracle enumerasi akun). FAIL-OPEN: kalau
// pengecekan limiter sendiri error, request TETAP dilanjutkan -- masalah infra tidak boleh
// pernah mengunci pengguna sah dari login. Batas sengaja SANGAT longgar (120/10 menit per IP)
// supaya seluruh organisasi (~82 akun) bisa login berbarengan dari satu wifi saat kegiatan
// tanpa kena limit, tapi tetap memotong brute-force/enumerasi otomatis yang butuh
// ratusan/ribuan percobaan. Naikkan lagi kalau ada venue dgn NAT sangat besar.
const RL_MAX = 120
const RL_WINDOW_SECONDS = 600
async function isRateLimited(supabaseAdmin: ReturnType<typeof adminClient>, ip: string): Promise<boolean> {
  try {
    const { data, error } = await supabaseAdmin.rpc('check_auth_rate_limit', {
      p_key: `resolve-login:${ip}`,
      p_max: RL_MAX,
      p_window_seconds: RL_WINDOW_SECONDS,
    })
    if (error) {
      console.error('[resolve-login] rate limit check error (fail-open):', error.message)
      return false
    }
    return data === false // RPC return false = diblokir
  } catch (e) {
    console.error('[resolve-login] rate limit exception (fail-open):', e)
    return false
  }
}

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    // Normalisasi HARUS identik dengan yang dilakukan di app/login/page.tsx (klien) dan
    // generateUniqueLoginUsername di app/api/users/route.ts (saat akun dibuat) -- trim
    // ujung + collapse spasi ganda jadi satu + uppercase. Kalau salah satu berubah tanpa
    // yang lain, nama dengan spasi tidak rapi (mis. "MORENO  RYANDIKA") bisa gagal cocok
    // padahal secara maksud sama persis.
    const normalized = username.trim().replace(/\s+/g, ' ').toUpperCase()
    if (!normalized) {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    const supabaseAdmin = adminClient()

    // Rate limit per-IP SEBELUM query apapun -- kalau diblokir, balas pesan generik yang
    // SAMA PERSIS dengan "nama tidak ditemukan" (status 429 + teks identik) supaya tidak
    // membocorkan apakah nama yang barusan dicoba valid atau tidak.
    if (await isRateLimited(supabaseAdmin, getClientIp(req))) {
      return NextResponse.json({ error: 'Nama pengguna atau password salah' }, { status: 429 })
    }

    // Coba cocok ke login_username dulu (nama panggilan, jalur utama & tercepat -- kolom
    // ini yang di-generate saat akun dibuat, lihat generateUniqueLoginUsername di
    // app/api/users/route.ts). Kalau tidak ketemu, fallback cocok ke nama_lengkap
    // (uppercase, exact match) -- BUG FIX: placeholder di app/login/page.tsx sudah lama
    // menjanjikan "NAMA LENGKAP ATAU NAMA PANGGILAN" tapi endpoint ini sebelumnya HANYA
    // mengecek login_username, jadi user yang selalu login pakai nama lengkap (mis. tidak
    // tahu/lupa nama panggilannya tersimpan sbg apa) tidak pernah bisa masuk walau
    // kredensialnya benar. nama_lengkap tidak di-normalize spasi krn tersimpan apa adanya
    // dari form (bukan hasil generate spt login_username), jadi hanya di-uppercase+trim.
    let { data } = await supabaseAdmin
      .from('users')
      .select('email')
      .eq('login_username', normalized)
      .eq('is_active', true)
      .maybeSingle()

    if (!data?.email) {
      // .limit(1) (bukan .maybeSingle()) sengaja dipakai di sini -- beda dari pencarian
      // login_username di atas yang dijamin unik oleh generateUniqueLoginUsername,
      // nama_lengkap TIDAK punya constraint unique di database (dua Generus beda
      // Kelompok bisa kebetulan punya nama sama persis). .maybeSingle() akan melempar
      // error kalau lebih dari 1 baris cocok -- .limit(1) + [0] lebih aman, ambil baris
      // pertama saja daripada gagal total.
      const byNamaLengkap = await supabaseAdmin
        .from('users')
        .select('email')
        .ilike('nama_lengkap', escapeIlike(normalized))
        .eq('is_active', true)
        .limit(1)
      data = byNamaLengkap.data?.[0] ?? null
    }

    if (!data?.email) {
      // Sengaja pesan generik -- sama seperti kredensial salah, supaya tidak bisa dipakai
      // menebak nama pengguna mana saja yang valid/aktif.
      return NextResponse.json({ error: 'Nama pengguna atau password salah' }, { status: 404 })
    }

    return NextResponse.json({ email: data.email })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
