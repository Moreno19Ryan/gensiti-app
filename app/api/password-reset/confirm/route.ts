import { createClient } from '@supabase/supabase-js'
import { createHash } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'

// Fase 2 dari reset password self-service (OTP email) -- lihat catatan pola adminClient()/
// escapeIlike() di app/api/password-reset/request/route.ts (disalin persis lagi di sini,
// konsisten dgn konvensi codebase: adminClient() sudah di-copy-paste verbatim di beberapa route).
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

const MAX_ATTEMPTS = 5

function hashOtp(otp: string, userId: string): string {
  return createHash('sha256').update(`${otp}:${userId}`).digest('hex')
}

function buildConfirmationEmailHtml(): string {
  return `
    <div style="max-width:520px;margin:0 auto;font-family:Segoe UI,Arial,sans-serif;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px;border-radius:12px 12px 0 0;">
        <p style="margin:0;color:#e0e7ff;font-size:13px;font-weight:600;">GENSITI · Smart Organization Management</p>
        <h1 style="margin:6px 0 0;color:#ffffff;font-size:20px;">Bidang Kegiatan Muda-Mudi Bekasi Timur</h1>
      </div>
      <div style="padding:24px;">
        <span style="display:inline-block;background:#dcfce7;color:#15803d;font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;">✓ Password Diperbarui</span>
        <h2 style="margin:14px 0 8px;color:#1e293b;font-size:18px;">Password Akun GENSITI Anda Berhasil Diubah</h2>
        <p style="margin:0;color:#475569;font-size:14px;line-height:1.6;">Password akun Anda baru saja diubah lewat halaman "Lupa Password" menggunakan kode verifikasi yang dikirim ke email ini.</p>
        <p style="margin:14px 0 0;color:#b91c1c;font-size:13px;line-height:1.5;">⚠️ Kalau Anda tidak melakukan ini, segera hubungi pengurus GENSITI -- kemungkinan email atau akun Anda diakses orang lain.</p>
      </div>
      <div style="padding:20px 24px;border-top:1px solid #e2e8f0;margin-top:24px;">
        <p style="margin:0;color:#94a3b8;font-size:12px;">Email ini dikirim otomatis oleh sistem GENSITI. Mohon tidak membalas email ini.</p>
        <p style="margin:4px 0 0;color:#94a3b8;font-size:12px;">© ${new Date().getFullYear()} GENSITI Bekasi Timur.</p>
      </div>
    </div>`
}

// Pesan+status SELALU identik utk "username tidak ditemukan/nonaktif", "tidak ada kode OTP
// aktif", "kode salah", "kode kadaluarsa", dan "sudah melebihi batas percobaan" -- endpoint ini
// stateless (tidak ada token yang membuktikan caller sudah lewat /request lebih dulu), jadi
// membedakan pesan di salah satu jalur akan membuka celah enumerasi username persis yang sudah
// ditutup di /api/resolve-login & /api/password-reset/request.
function invalidOtpResponse() {
  return NextResponse.json({ error: 'Kode OTP salah atau sudah kadaluarsa. Silakan minta kode baru.' }, { status: 400 })
}

export async function POST(req: NextRequest) {
  try {
    const { username, otp, newPassword } = await req.json()

    if (!username || typeof username !== 'string' || !otp || typeof otp !== 'string') {
      return NextResponse.json({ error: 'Nama pengguna dan kode OTP wajib diisi' }, { status: 400 })
    }
    if (!newPassword || String(newPassword).length < 6) {
      return NextResponse.json({ error: 'Password baru wajib diisi, minimal 6 karakter' }, { status: 400 })
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

    // Tidak ada pesan khusus "username tidak ditemukan" -- langsung jatuh ke response generik
    // yang sama persis dgn kode OTP salah/kadaluarsa (lihat invalidOtpResponse()).
    if (!user) {
      return invalidOtpResponse()
    }

    const { data: otpRow } = await supabaseAdmin
      .from('password_reset_otp')
      .select('id, otp_hash, attempt_count')
      .eq('user_id', user.id)
      .is('used_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!otpRow) {
      return invalidOtpResponse()
    }

    // Increment atomik (lihat migration increment_otp_attempt) supaya 2 request paralel utk
    // baris OTP yang sama tidak bisa saling "lolos" baca attempt_count basi (TOCTOU).
    const { data: newAttemptCount } = await supabaseAdmin.rpc('increment_otp_attempt', { p_otp_id: otpRow.id })

    if ((newAttemptCount ?? otpRow.attempt_count + 1) > MAX_ATTEMPTS) {
      // Bakar kode ini -- percobaan sudah melebihi batas, jangan izinkan dicoba lagi walau
      // belum expired. User harus minta kode baru lewat /api/password-reset/request.
      await supabaseAdmin.from('password_reset_otp').update({ used_at: new Date().toISOString() }).eq('id', otpRow.id)
      return invalidOtpResponse()
    }

    if (hashOtp(otp, user.id) !== otpRow.otp_hash) {
      return invalidOtpResponse()
    }

    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword })
    if (pwError) {
      return NextResponse.json({ error: pwError.message }, { status: 400 })
    }

    await supabaseAdmin.from('password_reset_otp').update({ used_at: new Date().toISOString() }).eq('id', otpRow.id)

    // Kegagalan kirim email konfirmasi TIDAK membatalkan proses -- password sudah terlanjur
    // berhasil diubah, sama pola dgn email di /api/password-reset/request.
    try {
      await supabaseAdmin.rpc('notify_email', {
        p_to: [user.email],
        p_subject: 'Password Akun GENSITI Anda Telah Diperbarui',
        p_html: buildConfirmationEmailHtml(),
        p_tipe: 'reset_password',
      })
    } catch (emailErr) {
      console.error('Gagal mengirim email konfirmasi reset password:', emailErr)
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
