import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

// Endpoint ini KHUSUS biodata Generus (tempat lahir, jenis kelamin, nama ortu/wali, dll).
// Dipisah dari app/api/users/route.ts (yang murni akun: email, no_hp, role, status aktif)
// supaya tiap endpoint punya satu tanggung jawab jelas.
//
// FASE 3 (strangler, audit native #2): KEDUA handler (GET & PATCH) sekarang cuma WRAPPER
// TIPIS di atas RPC database (get_generus_biodata / update_generus_biodata) yang jadi sumber
// kebenaran otorisasi tunggal -- seluruh cek akses & penulisan data ditegakkan di SQL. Route
// ini dipertahankan HANYA supaya kontrak HTTP-nya (dipanggil authFetch dari client) tidak
// berubah; begitu client native (Flutter) hadir, ia memanggil RPC yang SAMA secara langsung.
// Karena itu getCaller/canManageMembers/canActOnScope/generateUniqueLoginUsername yang dulu
// ada di sini (duplikat aturan TS) SUDAH DIHAPUS -- aturannya kini cuma hidup di DB.
//
// CATATAN -- alur PEMBUATAN akun baru (POST /api/users) TIDAK di sini. Membuat akun + biodata
// tetap satu transaksi di app/api/users/route.ts POST (butuh GoTrue createUser, tak bisa RPC).

// Client ber-scope JWT si PEMANGGIL (anon key + token user), BUKAN service-role. Dipakai
// untuk memanggil RPC yang menegakkan otorisasi lewat auth.uid() di dalam database -- supaya
// identitas pemanggil sampai ke fungsi SQL apa adanya, dan seluruh aturan akses jadi satu
// sumber kebenaran di DB (bukan diduplikasi lagi di TS). Ini persis pola yang nanti dipakai
// client native. autoRefresh/persist dimatikan -- request server berumur pendek, cuma butuh
// token sekali pakai dari header.
function userClient(token: string) {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  )
}

// Ambil token Bearer dari header Authorization -- dipakai kedua handler.
function bearerToken(req: NextRequest): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
}

// GET: Ambil biodata Generus by userId (lihat catatan Fase 3 di atas). Diizinkan untuk
// pemilik data sendiri, atau pengguna yang berwenang mengelola Generus dalam scope-nya --
// seluruhnya ditegakkan RPC get_generus_biodata.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const userId = searchParams.get('userId')
    if (!userId) return NextResponse.json({ error: 'userId wajib diisi' }, { status: 400 })

    const token = bearerToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Tidak ada token autentikasi (silakan login ulang).' }, { status: 401 })
    }

    const { data, error } = await userClient(token).rpc('get_generus_biodata', { p_user_id: userId })

    if (error) {
      // Petakan SQLSTATE yang di-RAISE RPC ke status HTTP yang SAMA seperti route lama:
      // 28000 (akun nonaktif/tak login) -> 401, 42501 (bukan pemilik & tak berwenang) -> 403.
      // Pesan generik -- tak membocorkan detail internal DB.
      const status = error.code === '28000' ? 401 : error.code === '42501' ? 403 : 500
      const message = status === 401 ? 'Unauthorized' : status === 403 ? 'Forbidden' : error.message
      return NextResponse.json({ error: message }, { status })
    }

    // RPC balik setof generus (0/1 baris -- user_id UNIQUE); samakan dgn kontrak lama yang
    // balik objek tunggal atau null.
    return NextResponse.json({ data: (data && data[0]) || null })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

// Field biodata/status yang diteruskan ke p_payload RPC update_generus_biodata. HANYA key yang
// benar-benar DIKIRIM client (present di body) yang diteruskan -- mirror semantik `!== undefined`
// versi TS lama; di dalam RPC dibedakan pakai operator jsonb `?` (key ada vs tidak). Konversi
// null/tipe (numeric/uuid/date/int/bool) & seluruh aturan otorisasi dilakukan di RPC, bukan di
// sini. (Catatan: key `status_anggota` dipetakan ke kolom generus.status di dalam RPC.)
const PAYLOAD_FIELDS = [
  'nama_panggilan', 'tempat_lahir', 'tanggal_lahir', 'jenis_kelamin', 'alamat',
  'tinggi_badan', 'berat_badan', 'kelas_ngaji',
  'nama_ayah', 'nama_ibu', 'nama_wali', 'no_hp_orangtua_wali',
  'status_anggota', 'status_pengguna',
  'pindah_desa_id', 'pindah_kelompok_id', 'pindah_ke_daerah_lain',
  'desa_id', 'kelompok_id',
  'anak_ke', 'jumlah_saudara',
] as const

// PATCH: Update biodata Generus (lihat catatan Fase 3 di atas). Dipakai profil/page.tsx
// saveDataDiri (biodata sendiri) & data-generus/page.tsx (biodata generus lain). Semua guard
// (self/scope, admin field, PPG, tempat sambung lama+baru) + sinkron login_username saat
// nama_panggilan berubah ditegakkan RPC update_generus_biodata secara ATOMIK (satu transaksi --
// kalau update generus gagal, sinkron login_username ikut rollback; lebih aman dari route lama
// yang bisa partial-fail).
export async function PATCH(req: NextRequest) {
  try {
    const token = bearerToken(req)
    if (!token) {
      return NextResponse.json({ error: 'Tidak ada token autentikasi (silakan login ulang).' }, { status: 401 })
    }

    const body = await req.json()
    if (!body?.user_id) return NextResponse.json({ error: 'user_id wajib diisi' }, { status: 400 })

    // Bangun payload cuma dari field yang dikirim (mirror `!== undefined`). user_id & generus_id
    // dikirim sbg parameter RPC terpisah, bukan bagian payload.
    const payload: Record<string, unknown> = {}
    for (const k of PAYLOAD_FIELDS) if (body[k] !== undefined) payload[k] = body[k]

    const { data, error } = await userClient(token).rpc('update_generus_biodata', {
      p_user_id: body.user_id,
      p_generus_id: body.generus_id ?? null,
      p_payload: payload,
    })

    if (error) {
      // 28000 -> 401, 42501 -> 403, 22004 (user_id wajib) -> 400. Untuk 4xx otorisasi, pesan
      // spesifik dari RPC diteruskan apa adanya (RPC me-RAISE string yang SAMA PERSIS dgn route
      // lama, mis. "Status keanggotaan akun PPG hanya dapat diubah oleh Super Admin.") supaya UX
      // pesan error tak berubah. Error DB lain (mis. CHECK constraint jenis_kelamin) -> 500.
      const code = error.code
      if (code === '28000') return NextResponse.json({ error: 'Sesi tidak valid (silakan login ulang).' }, { status: 401 })
      if (code === '42501') return NextResponse.json({ error: error.message }, { status: 403 })
      if (code === '22004') return NextResponse.json({ error: error.message }, { status: 400 })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // RPC balik jsonb { success: true } atau { success: true, newLoginUsername: <null|value> } --
    // bentuknya identik dgn kontrak lama, langsung diteruskan ke client.
    return NextResponse.json(data)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
