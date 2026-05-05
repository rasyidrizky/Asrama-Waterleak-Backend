require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("[ERROR] SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di file .env!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log("[DEBUG] Supabase terhubung");

module.exports = supabase;