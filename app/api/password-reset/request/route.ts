import { createClient } from '@supabase/supabase-js'
import { randomInt, createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

// Fase 1 dari reset password self-service (OTP email) -- endpoint PUBLIK (dipanggil dari
// /lupa-password SEBELUM ada sesi), jadi pola adminClient()/escapeIlike()/normalisasi username
// di sini SENGAJA disalin persis dari app/api/resolve-login/route.ts, bukan diimpor dari lib
// bersama -- konsisten dgn konvensi codebase ini (adminClient() sudah di-copy-paste verbatim di
// resolve-login, session/claim, dan (mantan) reset-password-requests routes).
function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

function escapeIlike(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

const OTP_EXPIRY_MINUTES = 10
const THROTTLE_WINDOW_MINUTES = 15
const THROTTLE_MAX_REQUESTS = 3

function hashOtp(otp: string, userId: string): string {
  return createHash('sha256').update(`${otp}:${userId}`).digest('hex')
}

function buildOtpEmailHtml(otp: string): string {
  // Dibangun manual di sini (bukan lewat RPC build_email_html) -- branch 'reset_password' di
  // fungsi itu isinya spesifik utk alur admin lama (password baru dikirim plaintext oleh Super
  // Admin), copy-nya sama sekali tidak cocok utk kode OTP. notify_email menerima html apapun,
  // tidak harus lewat build_email_html.
  return `
    <div style="max-width:520px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px;border-radius:12px 12px 0 0;">
        <p style="margin:0;color:#e0e7ff;font-size:13px;font-weight:600;">GENSITI · Smart Organization Management</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;">Bidang Kegiatan Muda-Mudi Bekasi Timur</h1>
      </div>
      <div style="padding:24px;">
        <span style="display:inline-block;background:#dbeafe;color:#1d4ed8;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;">🔑 Kode Reset Password</span>
        <h2 style="margin:14px 0 8px;color:#1e293b;font-size:18px;">Kode Verifikasi Reset Password Anda</h2>
        <p style="margin:0 0 14px;color:#475569;font-size:14px;line-height:1.6;">Gunakan kode berikut untuk mengatur ulang password akun GENSITI Anda:</p>
        <div style="padding:14px 16px;background:#f1f5f9;border-radius:8px;text-align:center;margin-bottom:14px;">
          <span style="font-family:monospace;font-size:28px;font-weight:700;color:#1e293b;letter-spacing:6px;">${otp}</span>
        </div>
        <p style="margin:0;color:#475569;font-size:13px;line-height:1.5;">Kode ini berlaku selama ${OTP_EXPIRY_MINUTES} menit. Jangan bagikan kode ini kepada siapapun, termasuk yang mengaku dari GENSITI.</p>
        <p style="margin:12px 0 0;color:#94a3b8;font-size:12px;">Kalau Anda tidak meminta reset password, abaikan email ini -- password Anda tidak berubah.</p>
      </div>
      <div style="padding:20px 24px;border-top:1px solid #e2e8f0;margin-top:24px;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Email ini dikirim otomatis oleh sistem GENSITI. Mohon tidak membalas email ini.</p>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} GENSITI Bekasi Timur.</p>
      </div>
    </div>`
}

// Pesan generik yang SELALU dikembalikan apapun hasilnya -- anti-enumeration, sama filosofi
// /api/resolve-login. Tidak pernah membedakan "username tidak ditemukan" vs "akun nonaktif"
// vs "sedang di-throttle" vs "berhasil kirim".
const GENERIC_RESPONSE = { message: 'Jika nama pengguna terdaftar, kode verifikasi sudah dikirim ke email yang terhubung dengan akun tersebut.' }

export async function POST(req: NextRequest) {
  try {
    const { username } = await req.json()
    if (!username || typeof username !== 'string') {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    const normalized = username.trim().replace(/\s+/g, ' ').toUpperCase()
    if (!normalized) {
      return NextResponse.json({ error: 'Nama pengguna wajib diisi' }, { status: 400 })
    }

    const supabaseAdmin = adminClient()

    let { data: user } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('login_username', normalized)
      .eq('is_active', true)
      .maybeSingle()

    if (!user) {
      const byNamaLengkap = await supabaseAdmin
        .from('users')
        .select('id, email')
        .ilike('nama_lengkap', escapeIlike(normalized))
        .eq('is_active', true)
        .limit(1)
      user = byNamaLengkap.data?.[0] ?? null
    }

    // Tidak ada early-return di sini kalau user tidak ketemu -- selalu lanjut ke response
    // generik di akhir fungsi, supaya endpoint ini tidak bisa dipakai menebak username mana
    // yang valid/aktif (waktu eksekusi & response HARUS identik dgn jalur "user ditemukan").
    if (user) {
      const windowStart = new Date(Date.now() - THROTTLE_WINDOW_MINUTES * 60_000).toISOString()
      const { count: recentCount } = await supabaseAdmin
        .from('password_reset_otp')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .gte('created_at', windowStart)

      if ((recentCount || 0) < THROTTLE_MAX_REQUESTS) {
        const otp = String(randomInt(100000, 1000000))
        const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString()

        const { error: insertError } = await supabaseAdmin.from('password_reset_otp').insert({
          user_id: user.id,
          otp_hash: hashOtp(otp, user.id),
          expires_at: expiresAt,
        })
        if (insertError) console.error('Gagal menyimpan OTP reset password:', insertError)

        try {
          await supabaseAdmin.rpc('notify_email', {
            p_to: [user.email],
            p_subject: 'Kode Verifikasi Reset Password GENSITI',
            p_html: buildOtpEmailHtml(otp),
            p_tipe: 'reset_password',
          })
        } catch (emailErr) {
          console.error('Gagal mengirim email OTP reset password:', emailErr)
        }
      }
      // Kalau recentCount >= THROTTLE_MAX_REQUESTS: sengaja tidak insert/kirim apapun, tapi
      // tetap jatuh ke response generik yang sama di bawah -- caller tidak tahu dia di-throttle.
    }

    return NextResponse.json(GENERIC_RESPONSE)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
