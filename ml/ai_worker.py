import time
import joblib
import pandas as pd
from supabase import create_client, Client
from datetime import datetime
import warnings
import os
from dotenv import load_dotenv

warnings.filterwarnings("ignore", category=UserWarning)

env_path = os.path.join(os.path.dirname(__file__), '..', '.env')
load_dotenv(env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL") 
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("Error: SUPABASE_URL atau SUPABASE_KEY tidak ditemukan di file .env!")
    exit()

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

print("Memuat file .joblib...")
try:
    loaded_data = joblib.load('./model/isolation_forest.joblib')
    
    model = loaded_data['model']
    feature_cols = loaded_data.get('feature_cols', [])
    
    print("Model Isolation Forest berhasil diekstrak!")
    if feature_cols:
        print(f"Fitur yang dibutuhkan: {feature_cols}")
except Exception as e:
    print(f"Gagal memuat model: {e}")
    exit()

def get_recent_telemetry(limit=30):
    try:
        response = supabase.table("telemetry_data") \
            .select("*") \
            .order("recorded_at", desc=True) \
            .limit(limit) \
            .execute()
        return response.data
    except Exception as e:
        print(f"Gagal menarik data: {e}")
        return []

def report_anomaly(node_id, score):
    try:
        active = supabase.table("anomalies").select("*").eq("node_id", node_id).eq("is_resolved", False).execute()
        if len(active.data) == 0:
            print(f"KEBOCORAN TERDETEKSI pada Node {node_id}! Mengirim peringatan ke Dashboard...")
            supabase.table("anomalies").insert({
                "node_id": node_id,
                "start_time": datetime.utcnow().isoformat(),
                "ai_score": round(abs(score), 3),
                "is_resolved": False
            }).execute()
    except Exception as e:
        print(f"Gagal mencatat anomali: {e}")

if __name__ == "__main__":
    print("Sistem AI Aktif: Memantau aliran air...")
    
    while True:
        data_history = get_recent_telemetry(30)
        
        if len(data_history) >= 2:
            df = pd.DataFrame(data_history)
            
            latest_flow = df.iloc[0]['flow_rate_lpm']
            flow_mean = df['flow_rate_lpm'].mean()
            flow_std = df['flow_rate_lpm'].std() if len(df) > 1 else 0
            flow_median = df['flow_rate_lpm'].median()
            flow_max = df['flow_rate_lpm'].max()
            flow_min = df['flow_rate_lpm'].min()
            flow_delta = latest_flow - df.iloc[1]['flow_rate_lpm']
            z_score = (latest_flow - flow_mean) / flow_std if flow_std > 0 else 0

            features_dict = {
                'flow_rate_lpm': latest_flow,
                'flow_mean_30': flow_mean,
                'flow_std_30': flow_std,
                'flow_median_30': flow_median,
                'flow_max_30': flow_max,
                'flow_min_30': flow_min,
                'flow_delta': flow_delta,
                'z_score_30': z_score
            }

            features = pd.DataFrame([features_dict])
            
            if feature_cols:
                features = features[feature_cols]

            try:
                prediction = model.predict(features)[0]
                anomaly_score = model.decision_function(features)[0]

                if prediction == -1:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] BAHAYA! Debit anomali terdeteksi: {latest_flow} L/m")
                    
                    report_anomaly(df.iloc[0]['node_id'], anomaly_score)
                else:
                    print(f"[{datetime.now().strftime('%H:%M:%S')}] Aman. Debit saat ini: {latest_flow} L/m")
                    
            except Exception as e:
                print(f"Kesalahan saat memprediksi: {e}")
                
        time.sleep(5)