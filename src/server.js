require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const swaggerUi = require('swagger-ui-express');
const swaggerDocument = require('../swagger.json');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const authenticateAndAuthorize = (requiredRole = null) => async (req, res, next) => {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: "Akses ditolak: Token JWT tidak ditemukan." });
    }

    const token = authHeader.split(' ')[1];

    try {
        const { data: { user }, error: authError } = await supabase.auth.getUser(token);
        if (authError || !user) throw authError;

        const { data: userProfile, error: profileError } = await supabase
            .from('users')
            .select('role')
            .eq('user_id', user.id)
            .single();

        if (profileError || !userProfile) {
            return res.status(403).json({ success: false, error: "Profil pengguna tidak ditemukan." });
        }

        if (requiredRole && userProfile.role !== requiredRole) {
            return res.status(403).json({ success: false, error: `Akses ditolak: Membutuhkan peran ${requiredRole}.` });
        }

        req.user = { id: user.id, email: user.email, role: userProfile.role };
        next();
    } catch (error) {
        return res.status(401).json({ success: false, error: "Sesi tidak valid atau telah kedaluwarsa." });
    }
};

app.post('/api/iot/telemetry', async (req, res) => {
    const { node_id, flow_rate_lpm, recorded_at } = req.body;

    const final_time = recorded_at || new Date().toISOString();

    console.log(`[IoT IN] Node: ${node_id.substring(0,8)} | Debit: ${flow_rate_lpm} L/m | Waktu: ${final_time}`);

    try {
        const { error: insertError } = await supabase
            .from('telemetry_data')
            .insert([{ node_id, flow_rate_lpm, recorded_at: final_time }]);
            
        if (insertError) {
            console.error("[DB ERROR] Gagal simpan ke Supabase:", insertError.message);
            return res.status(500).json({ success: false, error: insertError.message });
        }

        await supabase
            .from('nodes')
            .update({ is_online: true, last_sync: new Date() })
            .eq('node_id', node_id);

        res.status(200).json({ success: true, message: "Telemetri dicatat." });
    } catch (error) {
        console.error("Error Sistem IoT:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/web/executive/summary', authenticateAndAuthorize('Pengelola'), async (req, res) => {
    try {
        const { data: activeAnomalies } = await supabase
            .from('anomalies')
            .select('anomaly_id')
            .eq('is_resolved', false);

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

app.get('/api/web/nodes', authenticateAndAuthorize(), async (req, res) => {
    try {
        const { data: nodes, error: nodesError } = await supabase
            .from('nodes')
            .select('*')
            .order('location_block', { ascending: true });
            
        if (nodesError) throw nodesError;

        const { data: activeAnomalies, error: anomaliesError } = await supabase
            .from('anomalies')
            .select('anomaly_id, node_id')
            .eq('is_resolved', false);

        if (anomaliesError) throw anomaliesError;

        const formattedNodes = nodes.map(node => {
            const currentAnomaly = activeAnomalies.find(a => a.node_id === node.node_id);
            
            return {
                ...node,
                has_anomaly: !!currentAnomaly,
                anomaly_id: currentAnomaly ? currentAnomaly.anomaly_id : null
            };
        });

        res.status(200).json({ success: true, data: formattedNodes });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

        const formattedData = data.map(log => {
            const timeLocal = new Date(log.recorded_at).toLocaleTimeString('id-ID', { 
                timeZone: 'Asia/Jakarta',
                hour: '2-digit', 
                minute: '2-digit',
                second: '2-digit'
            });

            return {
                timeISO: timeLocal, 
                debit: parseFloat(log.flow_rate_lpm)
            };
        });

        res.status(200).json({ success: true, data: formattedData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/web/telemetry-all', authenticateAndAuthorize(), async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('telemetry_data')
            .select('node_id, flow_rate_lpm, recorded_at')
            .order('recorded_at', { ascending: true })
            .limit(200);

        if (error) throw error;

        const groupedData = data.reduce((acc, log) => {
            const time = new Date(log.recorded_at).toLocaleTimeString('id-ID', { 
                timeZone: 'Asia/Jakarta', 
                hour: '2-digit', 
                minute: '2-digit' 
            });

            if (!acc[time]) acc[time] = { time };
            
            acc[time][log.node_id] = parseFloat(log.flow_rate_lpm);
            return acc;
        }, {});

        res.status(200).json({ success: true, data: Object.values(groupedData) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.put('/api/web/resolve/:anomalyId', authenticateAndAuthorize('Teknisi'), async (req, res) => {
    const { anomalyId } = req.params;
    const { action_description } = req.body;
    
    try {
        const { data: anomalyInfo } = await supabase
            .from('anomalies')
            .select('node_id')
            .eq('anomaly_id', anomalyId)
            .single();

        const { error: updateAnomalyError } = await supabase
            .from('anomalies')
            .update({ is_resolved: true, end_time: new Date() })
            .eq('anomaly_id', anomalyId);
        
        if (updateAnomalyError) throw updateAnomalyError;

        const { error: insertLogError } = await supabase
            .from('incident_logs')
            .insert([{
                anomaly_id: anomalyId,
                user_id: req.user.id,
                action_description: action_description || "Perbaikan fisik selesai dilakukan.",
                action_timestamp: new Date()
            }]);

        if (insertLogError) throw insertLogError;

        if (anomalyInfo) {
            await supabase
                .from('nodes')
                .update({ status: 'NORMAL', has_anomaly: false })
                .eq('node_id', anomalyInfo.node_id);
        }

        res.status(200).json({ success: true, message: "Insiden berhasil diselesaikan dan dicatat dalam log audit." });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/web/logs', authenticateAndAuthorize(), async (req, res) => {
    try {
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

const PORT = process.env.PORT || 5000; 
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Web Service aktif di port ${PORT}`);
});