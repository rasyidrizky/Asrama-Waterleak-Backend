require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(cors());
app.use(express.json());

// Inisialisasi Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

// ============================================================================
// MIDDLEWARE: Autentikasi & RBAC (Role-Based Access Control)
// ============================================================================
const authenticateAndAuthorize = (requiredRole = null) => async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "Akses ditolak: Token JWT tidak ditemukan." });
    }

    const token = authHeader.split(' ')[1];

    try {
        // 1. Validasi token JWT ke Supabase Auth
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw authError;

        // 2. Ambil peran (role) dari tabel users (Skema 5 Tabel)
        const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .single();

        if (profileError || !userProfile) {
            return res.status(403).json({ success: false, error: "Profil pengguna tidak ditemukan." });
        }

        // 3. Cek apakah role sesuai dengan yang diminta (jika ada batasan)
        if (requiredRole && userProfile.role !== requiredRole) {
            return res.status(403).json({ success: false, error: `Akses ditolak: Membutuhkan peran ${requiredRole}.` });
        }

        // 4. Simpan data user & role ke dalam request untuk dipakai di rute
        req.user = { id: user.id, email: user.email, role: userProfile.role };
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Sesi tidak valid atau telah kedaluwarsa." });
    }
};

// ============================================================================
// 1. RUTE IOT (EDGE LAYER) - Menggunakan skema D3
// ============================================================================
app.post('/api/iot/telemetry', async (req, res) => {
    // Menyesuaikan dengan nama kolom D3
    const { node_id, flow_rate_lpm } = req.body; 

    try {
        // A. Simpan data ke telemetry_data
        await supabase
            .from('telemetry_data')
            .insert([{ node_id, flow_rate_lpm }]);

        // B. Perbarui status is_online di tabel nodes
        await supabase
            .from('nodes')
            .update({ is_online: true, last_sync: new Date() })
            .eq('node_id', node_id);

        // C. [SIMULASI AI] Jika flow_rate mencurigakan, catat ke tabel anomalies
        // Di sistem nyata, ini dipicu oleh FastAPI Python
        if (flow_rate_lpm > 15) { 
            await supabase
                .from('anomalies')
                .insert([{ 
                    node_id, 
                    start_time: new Date(), 
                    ai_score: 0.95, 
                    is_resolved: false 
                }]);
            
            // Note: Di sini Web Push Notification akan dipicu untuk Pengelola
        }

        res.status(200).json({ success: true, message: "Telemetri dicatat." });
    } catch (error) {
        console.error("Error IoT:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// 2. RUTE WEBSITE - PENGELOLA (Executive View / Pengganti Mobile App)
// ============================================================================
app.get('/api/web/executive/summary', authenticateAndAuthorize('Pengelola'), async (req, res) => {
    try {
        // Hitung total anomali yang belum diselesaikan
        const { data: activeAnomalies } = await supabase
            .from('anomalies')
            .select('anomaly_id')
            .eq('is_resolved', false);

        // Hitung status infrastruktur
        const { data: nodes } = await supabase.from('nodes').select('node_id, is_online');
        const activeNodesCount = nodes.filter(n => n.is_online).length;

        res.status(200).json({
            success: true,
            data: {
                total_infrastruktur: nodes.length,
                infrastruktur_aktif: activeNodesCount,
                kebocoran_saat_ini: activeAnomalies ? activeAnomalies.length : 0,
                status_kesehatan: activeAnomalies.length === 0 ? "Normal" : "Perlu Perhatian"
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// 3. RUTE WEBSITE - TEKNISI (Detailed View)
// ============================================================================

// A. Mengambil Daftar Infrastruktur (Termasuk diameter pipa)
app.get('/api/web/nodes', authenticateAndAuthorize('Teknisi'), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('nodes')
            .select('*')
            .order('location_block', { ascending: true });
            
        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// B. Mengambil Grafik Telemetri 
app.get('/api/web/telemetry/:nodeId', authenticateAndAuthorize('Teknisi'), async (req, res) => {
    const { nodeId } = req.params;
    try {
        const { data, error } = await supabase
            .from('telemetry_data')
            .select('flow_rate_lpm, recorded_at')
            .eq('node_id', nodeId)
            .order('recorded_at', { ascending: true })
            .limit(60);

        if (error) throw error;

        const formattedData = data.map(log => ({
            timeISO: new Date(log.recorded_at).toISOString(), 
            debit: parseFloat(log.flow_rate_lpm)
        }));

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// C. Alur Resolusi Insiden (Mencatat ke incident_logs)
app.put('/api/web/resolve/:anomalyId', authenticateAndAuthorize('Teknisi'), async (req, res) => {
    const { anomalyId } = req.params;
    const { action_description } = req.body; // Catatan teknisi dari form frontend
    
    try {
        // 1. Ubah status anomali menjadi terselesaikan
        const { error: updateAnomalyError } = await supabase
            .from('anomalies')
            .update({ is_resolved: true, end_time: new Date() })
            .eq('anomaly_id', anomalyId);
        
        if (updateAnomalyError) throw updateAnomalyError;

        // 2. Catat siapa teknisi yang membetulkan ke tabel incident_logs
        const { error: insertLogError } = await supabase
            .from('incident_logs')
            .insert([{
                anomaly_id: anomalyId,
                user_id: req.user.id, // Diambil otomatis dari token JWT
                action_description: action_description || "Perbaikan fisik selesai dilakukan.",
                action_timestamp: new Date()
            }]);

        if (insertLogError) throw insertLogError;

        res.status(200).json({ success: true, message: "Insiden berhasil diselesaikan dan dicatat dalam log audit." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// D. Halaman Audit / Log Riwayat
app.get('/api/web/logs', authenticateAndAuthorize('Teknisi'), async (req, res) => {
    try {
        // Melakukan JOIN antara anomalies, incident_logs, dan nodes
        const { data, error } = await supabase
            .from('anomalies')
            .select(`
                anomaly_id, start_time, end_time, ai_score, is_resolved,
                nodes ( location_block, pipe_diameter ),
                incident_logs ( action_description, action_timestamp, users ( email ) )
            `)
            .order('start_time', { ascending: false });

        if (error) throw error;
        res.status(200).json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// JALANKAN SERVER 
// ============================================================================
const PORT = process.env.PORT || 5000; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Service aktif di port ${PORT}`);
});