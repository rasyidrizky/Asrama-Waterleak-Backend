// Memuat variabel lingkungan dari file .env
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

// Mengambil URL dan API Key dari variabel lingkungan
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

// Validasi darurat jika .env belum diisi atau tidak terbaca
if (!supabaseUrl || !supabaseKey) {
  console.error("GAGAL: SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di file .env!");
  process.exit(1);
}

// Inisialisasi dan ekspor klien Supabase
const supabase = createClient(supabaseUrl, supabaseKey);

console.log("-> Klien Supabase berhasil diinisialisasi.");

module.exports = supabase;