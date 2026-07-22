// Fitur presensi via kartu RFID (mode kiosk: reader dipegang Pengurus) sudah lengkap di sisi
// kode -- skema (generus.kartu_rfid_uid, kegiatan.presensi_metode_rfid), RPC
// (daftarkan_kartu_rfid, cabut_kartu_rfid, submit_presensi_rfid), dan komponennya
// (RfidKioskInput) -- tapi belum pernah divalidasi pakai reader USB fisik sungguhan.
// Flag ini sengaja dikunci `false` supaya opsi RFID tidak muncul dulu di UI produksi
// (tampil "Segera Hadir") sampai pengujian fisik berhasil. Ganti ke `true` lalu deploy
// setelah itu -- tidak perlu perubahan kode lain.
export const RFID_PRESENSI_READY = false
