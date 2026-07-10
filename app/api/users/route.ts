import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function adminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

interface Caller {
  id: string
  tingkatan: string | null
  nama_role: string | null
  desa_id: string | null
  kelompok_id: string | null
}

// Memverifikasi bearer token dari header Authorization dan mengambil profil + role pemanggil.
// Semua endpoint di file ini memakai service role key (bypass RLS), jadi verifikasi ini WAJIB
// dilakukan manual di server — tanpa ini siapapun bisa memanggil endpoint tanpa login sama sekali.
//
// Mengembalikan { caller, reason } alih-alih cuma null, supaya pesan "Unauthorized" yang
// dikirim ke client bisa menyertakan alasan spesifik (token kosong, token invalid/expired,
// profil tidak ketemu, akun nonaktif, dst) -- sebelumnya semua kegagalan disamakan jadi satu
// pesan generik "Unauthorized" yang menyulitkan diagnosis dari sisi pengguna/browser.
async function getCaller(req: NextRequest, supabaseAdmin: ReturnType<typeof adminClient>): Promise<{ caller: Caller | null; reason?: string }> {
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    console.error('[getCaller] Tidak ada Authorization header / token kosong')
    return { caller: null, reason: 'Tidak ada token autentikasi (silakan login ulang).' }
  }

  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token)
  if (userErr || !userData.user) {
    console.error('[getCaller] auth.getUser gagal:', userErr?.message || 'user null')
    return { caller: null, reason: `Sesi tidak valid: ${userErr?.message || 'user tidak ditemukan'} (silakan login ulang).` }
  }

  const { data: profile, error: profileErr } = await supabaseAdmin
    .from('users')
    .select('id, desa_id, kelompok_id, is_active, roles:role_id(nama_role, tingkatan)')
    .eq('id', userData.user.id)
    .single()

  if (profileErr) {
    console.error('[getCaller] Query profil users gagal untuk', userData.user.id, ':', profileErr.message)
    return { caller: null, reason: `Gagal memuat profil: ${profileErr.message}` }
  }

  if (!profile) {
    return { caller: null, reason: 'Profil pengguna tidak ditemukan di database.' }
  }
  if (profile.is_active === false) {
    return { caller: null, reason: 'Akun tidak aktif.' }
  }

  const role = profile.roles as { nama_role?: string; tingkatan?: string } | { nama_role?: string; tingkatan?: string }[] | null
  const roleObj = Array.isArray(role) ? role[0] : role

  return {
    caller: {
      id: profile.id,
      tingkatan: roleObj?.tingkatan || null,
      nama_role: roleObj?.nama_role || null,
      desa_id: profile.desa_id,
      kelompok_id: profile.kelompok_id,
    },
  }
}

// Hanya Ketua/Wakil Ketua/Sekretaris (semua scope) dan Super Admin yang boleh mengelola
// Generus lain -- termasuk membuat pengguna baru dan mengubah status aktif/nonaktif akun
// (mis. saat status berubah jadi menikah/meninggal dunia/pindah sambung). Harus SELALU
// konsisten dengan canManageMembers() di lib/roles.ts (yang mengatur visibilitas UI) --
// ini adalah enforcement sesungguhnya di server, UI hanya cerminan agar tidak menyesatkan.
function canManageMembers(caller: Caller): boolean {
  if (caller.tingkatan === 'super_admin') return true
  if (!caller.nama_role) return false
  const nama = caller.nama_role.toLowerCase()
  return nama.includes('ketua') || nama.includes('sekretaris')
}

// Cek apakah caller berwenang bertindak atas target berdasarkan scope desa/kelompok.
function canActOnScope(caller: Caller, targetDesaId: string | null, targetKelompokId: string | null): boolean {
  if (!canManageMembers(caller)) return false
  if (caller.tingkatan === 'super_admin' || caller.tingkatan === 'daerah') return true
  if (caller.tingkatan === 'desa') return targetDesaId === caller.desa_id
  if (caller.tingkatan === 'kelompok') return targetKelompokId === caller.kelompok_id
  return false
}

// Super Admin adalah akun tunggal & mutlak — tidak boleh ada akun kedua yang dibuat
// dengan role bertingkatan super_admin, oleh siapapun (termasuk sesama Super Admin),
// lewat jalur aplikasi ini. Perubahan role sistem hanya boleh terjadi langsung di database.
// Ditegakkan lewat getRoleTingkatan() di bawah (bukan fungsi terpisah lagi) supaya query role
// hanya dilakukan sekali per request dan dipakai bersama oleh cek super_admin & cek hierarki.
async function getRoleTingkatan(supabaseAdmin: ReturnType<typeof adminClient>, roleId: string | null | undefined): Promise<string | null> {
  if (!roleId) return null
  const { data } = await supabaseAdmin.from('roles').select('tingkatan').eq('id', roleId).single()
  return data?.tingkatan || null
}

// Hierarki jenjang, dari paling "bawah" ke paling "atas" -- HARUS SELALU KONSISTEN dengan
// TINGKATAN_HIERARKI + getAllowedTargetTingkatan di lib/roles.ts (versi UI, hanya menyembunyikan
// pilihan di dropdown). Ini adalah ENFORCEMENT SESUNGGUHNYA (endpoint ini pakai service role,
// bypass RLS sepenuhnya) -- tanpa pengecekan ini, siapapun yang lolos canManageMembers() bisa
// membuat/mengubah user ke role APAPUN (termasuk lebih tinggi dari dirinya sendiri) hanya dengan
// mengirim role_id yang diinginkan langsung ke endpoint, terlepas dari apa yang ditampilkan UI.
const TINGKATAN_HIERARKI = ['kelompok', 'desa', 'daerah', 'ppg', 'super_admin']

function getAllowedTargetTingkatan(caller: Caller): string[] {
  if (caller.tingkatan === 'super_admin') {
    return TINGKATAN_HIERARKI.filter(t => t !== 'super_admin')
  }
  // PPG dicek eksplisit -- 'ppg' adalah anggota TINGKATAN_HIERARKI (batas atas utk role Daerah),
  // jadi tanpa exclude eksplisit ini, indexOf('ppg') mengembalikan index valid dan caller PPG
  // keliru diizinkan "membuat" role sampai jenjangnya sendiri. PPG tidak pernah boleh membuat/
  // mengubah role siapapun (konsisten dgn PPG dikecualikan dari canManageMembers() di atas).
  if (caller.tingkatan === 'ppg') return []
  const idx = TINGKATAN_HIERARKI.indexOf(caller.tingkatan || '')
  if (idx === -1) return []
  return TINGKATAN_HIERARKI.slice(0, idx + 1)
}

// Cek apakah caller berwenang menetapkan role bertingkatan `targetTingkatan` ke user (baru
// atau existing) -- inti pembatasan "role di bawah tidak bisa menambahkan/menaikkan role ke
// atasnya". Dipanggil di POST (create) dan PATCH (saat role_id ikut diubah).
function canAssignTingkatan(caller: Caller, targetTingkatan: string | null | undefined): boolean {
  if (!targetTingkatan) return true // role_id null/kosong (generus tanpa role eksplisit) selalu boleh
  return getAllowedTargetTingkatan(caller).includes(targetTingkatan)
}

// Generate login_username unik dari nama panggilan (fallback nama lengkap). Login sekarang
// pakai nama (bukan email) karena banyak Generus di bawah umur belum punya email sendiri --
// lihat app/api/resolve-login/route.ts & app/login/page.tsx. Kalau nama sudah dipakai user
// lain, tambahkan suffix angka menaik (mis. "AHMAD FAUZI" -> "AHMAD FAUZI (2)") sesuai
// keputusan produk: otomatis, tidak perlu campur tangan admin tiap kali ada nama bentrok.
async function generateUniqueLoginUsername(
  supabaseAdmin: ReturnType<typeof adminClient>,
  baseName: string
): Promise<string> {
  // Normalisasi HARUS identik dengan app/login/page.tsx & app/api/resolve-login/route.ts
  // (trim + collapse spasi ganda + uppercase) -- supaya nama dengan spasi tidak rapi saat
  // input form Tambah Pengguna tetap menghasilkan login_username yang bisa dicocokkan
  // persis saat login nanti.
  const base = baseName.trim().replace(/\s+/g, ' ').toUpperCase()
  let candidate = base
  let suffix = 2
  // Batas wajar (100 percobaan) supaya tidak infinite loop kalau ada anomali data.
  for (let i = 0; i < 100; i++) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('login_username', candidate)
      .maybeSingle()
    if (!data) return candidate
    candidate = `${base} (${suffix})`
    suffix++
  }
  // Fallback ekstrem: tempel sebagian id acak supaya tetap unik.
  return `${base} (${Date.now()})`
}

// Password default akun baru = tanggal lahir format DDMMYYYY (mis. 17081998 utk 17 Agustus
// 1998). Alasan: banyak Generus di bawah umur, tanggal lahir mudah diingat & tetap aman
// dalam konteks organisasi kekeluargaan ini. User yang ingin password lebih aman bisa
// mengajukan revisi/reset lewat halaman /lupa-password (diproses manual oleh Super Admin).
function passwordFromTanggalLahir(tanggalLahir: string): string {
  const d = new Date(tanggalLahir)
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}${mm}${yyyy}`
}

// CATATAN -- GET (ambil biodata Generus by userId) sudah DIPINDAH ke app/api/generus/route.ts,
// karena itu murni operasi biodata, bukan akun. File ini sekarang fokus ke akun: membuat user
// baru (POST, tetap gabungan dgn biodata krn satu transaksi pembuatan) dan update field akun
// murni (PATCH: email/no_hp/role/status aktif/avatar) -- lihat app/api/generus/route.ts utk
// PATCH biodata (tempat lahir, nama ortu, dst).

// POST: Buat user baru + generus record
// Hanya boleh dipanggil oleh Ketua/Wakil Ketua/Super Admin.
export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const { caller, reason } = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: reason || 'Unauthorized' }, { status: 401 })
    if (!canManageMembers(caller)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const {
      email, nama_lengkap, nama_panggilan, no_hp,
      role_id, desa_id, kelompok_id,
      tempat_lahir, tanggal_lahir, jenis_kelamin, alamat,
      tinggi_badan, berat_badan, kelas_ngaji,
      nama_ayah, nama_ibu, nama_wali, no_hp_orangtua_wali,
      status_anggota,
      status_pengguna,
      anak_ke,
      jumlah_saudara,
    } = await req.json()

    // password TIDAK LAGI diterima dari client -- selalu di-generate server-side dari
    // tanggal_lahir (lihat passwordFromTanggalLahir), supaya konsisten & tidak bisa
    // dipalsukan/diskip dari form. tanggal_lahir karena itu WAJIB diisi untuk akun baru
    // (beda dari sebelumnya yang opsional), sesuai keputusan produk: password default =
    // tanggal lahir, ganti password hanya lewat pengajuan revisi/reset manual.
    if (!email || !nama_lengkap || !tanggal_lahir) {
      return NextResponse.json({ error: 'Email, nama lengkap, dan tanggal lahir wajib diisi' }, { status: 400 })
    }
    const password = passwordFromTanggalLahir(tanggal_lahir)

    // Admin desa/kelompok hanya boleh membuat user dalam scope-nya sendiri
    if (!canActOnScope(caller, desa_id || null, kelompok_id || null)) {
      return NextResponse.json({ error: 'Anda tidak berwenang membuat pengguna di luar scope Anda.' }, { status: 403 })
    }

    // Super Admin adalah akun tunggal mutlak — tidak boleh ada user baru dibuat dengan role ini.
    const targetRoleTingkatan = await getRoleTingkatan(supabaseAdmin, role_id)
    if (targetRoleTingkatan === 'super_admin') {
      return NextResponse.json({ error: 'Tidak dapat membuat pengguna dengan role Super Admin.' }, { status: 403 })
    }

    // Hierarki jenjang: role di bawah tidak boleh membuat pengguna dengan role di atasnya
    // (mis. Sekretaris Kelompok tidak boleh membuat "Ketua Daerah" atau akun PPG). Hanya
    // Super Admin yang boleh membuat akun PPG.
    if (!canAssignTingkatan(caller, targetRoleTingkatan)) {
      return NextResponse.json({
        error: `Anda tidak berwenang membuat pengguna dengan role di jenjang "${targetRoleTingkatan}". Role yang boleh Anda buat: ${getAllowedTargetTingkatan(caller).join(', ') || '(tidak ada)'}.`,
      }, { status: 403 })
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    if (authError) return NextResponse.json({ error: authError.message }, { status: 400 })

    const userId = authData.user.id

    const loginUsername = await generateUniqueLoginUsername(supabaseAdmin, nama_panggilan || nama_lengkap)

    const { error: profileError } = await supabaseAdmin.from('users').insert({
      id: userId,
      email,
      nama_lengkap,
      login_username: loginUsername,
      no_hp: no_hp || null,
      role_id: role_id || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      // Status akun baru SELALU aktif & lajang secara default -- ini bukan pilihan yang
      // ditampilkan di form (dihapus dari UI sesuai permintaan), murni nilai awal wajar
      // untuk pengguna yang baru dibuat.
      is_active: true,
      is_archived: false,
    })

    if (profileError) {
      await supabaseAdmin.auth.admin.deleteUser(userId)
      return NextResponse.json({ error: profileError.message }, { status: 500 })
    }

    // CATATAN -- kolom nama_lengkap/no_hp/foto_url TIDAK ditulis ke tabel generus.
    // Dulu ditulis manual ke dua tabel (users & generus) sekaligus, tapi ini rawan
    // divergen kalau salah satu insert gagal sebagian (terbukti terjadi di production:
    // data Moreno & Raihan sempat beda antara users vs generus). Sekarang users adalah
    // SATU-SATUNYA sumber kebenaran utk 3 kolom itu; generus.desa_id/kelompok_id tetap
    // ditulis krn punya makna berbeda (tempat sambung generus, lihat komentar di PATCH).
    const { error: generusError } = await supabaseAdmin.from('generus').insert({
      user_id: userId,
      nama_panggilan: nama_panggilan || null,
      tempat_lahir: tempat_lahir || null,
      tanggal_lahir: tanggal_lahir || null,
      jenis_kelamin: jenis_kelamin || null,
      alamat: alamat || null,
      tinggi_badan: tinggi_badan || null,
      berat_badan: berat_badan || null,
      kelas_ngaji: kelas_ngaji || null,
      desa_id: desa_id || null,
      kelompok_id: kelompok_id || null,
      status: status_anggota || 'aktif',
      nama_ayah: nama_ayah || null,
      nama_ibu: nama_ibu || null,
      nama_wali: nama_wali || null,
      no_hp_orangtua_wali: no_hp_orangtua_wali || null,
      status_pengguna: status_pengguna || 'lajang',
      pindah_ke_daerah_lain: false,
      anak_ke: anak_ke || null,
      jumlah_saudara: jumlah_saudara || null,
    })

    // PENTING -- sama seperti kasus PATCH (lihat komentar di bawah), sebelumnya error di sini
    // hanya di-console.error dan endpoint tetap balas success:true dengan kredensial akun baru.
    // Ini berarti akun BISA dibuat dan login, tapi biodata Generus-nya (nama panggilan, tempat/
    // tanggal lahir, jenis kelamin) gagal tersimpan tanpa admin pernah tahu. Sekarang dilaporkan
    // sebagai error yang jelas -- akun login sudah terlanjur dibuat (auth + tabel users), tapi
    // admin diberi tahu agar segera melengkapi biodata lewat menu Data Generus.
    if (generusError) {
      console.error('Generus insert error:', generusError.message)
      return NextResponse.json({
        error: `Akun berhasil dibuat, tapi biodata Generus GAGAL disimpan: ${generusError.message}. Silakan lengkapi biodata lewat menu Data Generus.`,
        userId, loginUsername, defaultPassword: password,
      }, { status: 207 })
    }

    return NextResponse.json({ success: true, userId, loginUsername, defaultPassword: password })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// PATCH: Update field AKUN murni (email/no_hp/role/scope/status aktif/avatar/password).
// Biodata Generus (tempat lahir, nama ortu, dll) TIDAK lagi ditangani di sini -- lihat
// app/api/generus/route.ts PATCH. Field desa_id/kelompok_id di sini adalah SCOPE AKUN
// (dipakai utk otorisasi & filter), beda dari generus.desa_id/kelompok_id yang berarti
// tempat sambung generus saat ini (lihat komentar di app/api/generus/route.ts).
export async function PATCH(req: NextRequest) {
  try {
    const supabaseAdmin = adminClient()
    const { caller, reason } = await getCaller(req, supabaseAdmin)
    if (!caller) return NextResponse.json({ error: reason || 'Unauthorized' }, { status: 401 })

    const {
      id, nama_lengkap, no_hp, role_id, desa_id, kelompok_id, is_active, password,
      avatar_url,
      archive, alasan_arsip,
    } = await req.json()

    if (!id) return NextResponse.json({ error: 'ID wajib diisi' }, { status: 400 })

    // Proteksi super_admin: cek role & scope target sebelum mengizinkan perubahan
    const { data: targetUserRole } = await supabaseAdmin
      .from('users')
      .select('desa_id, kelompok_id, roles:role_id(tingkatan)')
      .eq('id', id)
      .single()
    const targetRole = targetUserRole?.roles as { tingkatan?: string } | { tingkatan?: string }[] | null
    const isTargetSuperAdmin = (Array.isArray(targetRole) ? targetRole[0]?.tingkatan : targetRole?.tingkatan) === 'super_admin'

    const isSelf = id === caller.id
    // Otorisasi: harus salah satu dari — mengubah data diri sendiri, atau berwenang
    // mengelola anggota lain dalam scope-nya (Ketua/Wakil/Super Admin sesuai desa/kelompok).
    if (!isSelf) {
      const targetDesaId = targetUserRole?.desa_id ?? null
      const targetKelompokId = targetUserRole?.kelompok_id ?? null
      if (!canActOnScope(caller, targetDesaId, targetKelompokId)) {
        return NextResponse.json({ error: 'Anda tidak berwenang mengubah pengguna ini.' }, { status: 403 })
      }
    }

    if (isTargetSuperAdmin) {
      // Super admin HANYA boleh update: no_hp, avatar_url, dan password
      // Semua field lain — termasuk nama_lengkap — diblokir sepenuhnya
      const hasProtectedFields = nama_lengkap !== undefined
        || role_id !== undefined || desa_id !== undefined || kelompok_id !== undefined
        || is_active !== undefined || archive !== undefined
      if (hasProtectedFields) {
        return NextResponse.json({ error: 'Profil Super Admin tidak dapat diubah.' }, { status: 403 })
      }
    }

    // Field administratif (role, scope, status akun) hanya boleh diubah oleh yang berwenang
    // mengelola Generus — mencegah pengguna menaikkan hak aksesnya sendiri lewat halaman profil.
    const hasAdminFields = role_id !== undefined || is_active !== undefined || archive !== undefined
    if (hasAdminFields && !canManageMembers(caller)) {
      return NextResponse.json({ error: 'Anda tidak berwenang mengubah role atau status akun.' }, { status: 403 })
    }

    // Super Admin adalah akun tunggal mutlak — role_id siapapun tidak boleh diarahkan
    // menjadi Super Admin lewat aplikasi ini, oleh siapapun termasuk Super Admin itu sendiri.
    if (role_id !== undefined) {
      const newRoleTingkatan = await getRoleTingkatan(supabaseAdmin, role_id)
      if (newRoleTingkatan === 'super_admin') {
        return NextResponse.json({ error: 'Tidak dapat mengubah role pengguna menjadi Super Admin.' }, { status: 403 })
      }
      // Hierarki jenjang berlaku juga saat mengedit role user existing (bukan cuma saat
      // membuat baru) -- kalau tidak, pembatasan create bisa dilewati dgn cara membuat user
      // biasa dulu lalu langsung menaikkan role-nya lewat form edit.
      if (!isSelf && !canAssignTingkatan(caller, newRoleTingkatan)) {
        return NextResponse.json({
          error: `Anda tidak berwenang mengubah role pengguna ke jenjang "${newRoleTingkatan}". Role yang boleh Anda tetapkan: ${getAllowedTargetTingkatan(caller).join(', ') || '(tidak ada)'}.`,
        }, { status: 403 })
      }
    }

    if (password) {
      await supabaseAdmin.auth.admin.updateUserById(id, { password })
    }

    const userPayload: Record<string, unknown> = {}
    if (nama_lengkap !== undefined) userPayload.nama_lengkap = nama_lengkap
    if (no_hp !== undefined) userPayload.no_hp = no_hp || null
    if (role_id !== undefined) userPayload.role_id = role_id || null
    if (desa_id !== undefined) userPayload.desa_id = desa_id || null
    if (kelompok_id !== undefined) userPayload.kelompok_id = kelompok_id || null
    if (is_active !== undefined) userPayload.is_active = is_active
    if (avatar_url !== undefined) {
      userPayload.avatar_url = avatar_url || null
      userPayload.foto_url = avatar_url || null
    }

    if (archive === true) {
      userPayload.is_active = false
      userPayload.is_archived = true
      userPayload.alasan_arsip = alasan_arsip || 'Tidak diketahui'
      userPayload.tanggal_arsip = new Date().toISOString()
    }

    if (Object.keys(userPayload).length > 0) {
      const { error } = await supabaseAdmin.from('users').update(userPayload).eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
