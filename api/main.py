# skrip utama server FastAPI berisi API inferensi model AI

from datetime import datetime
from typing import List

import pandas as pd
from fastapi import FastAPI
from pydantic import BaseModel

from model_loader import get_model_artifact
from inference import predict

# skema input request
class TelemetryPoint(BaseModel):
    node_id: str
    recorded_at: datetime
    flow_rate_lpm: float


class PredictRequest(BaseModel):
    records: List[TelemetryPoint]


# skema output response
class PredictItem(BaseModel):
    node_id: str
    recorded_at: datetime
    score: float
    is_anomaly: int
    is_anomaly_filtered: int


class PredictResponse(BaseModel):
    results: List[PredictItem]
    warnings: List[str] = []


app = FastAPI(title="Asrama Water Leak Anomaly Inference")

# endpoint health check utk monitoring server sederhana
@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict", response_model=PredictResponse)
def predict_endpoint(payload: PredictRequest):
    # ambil model + metadata dari artifact
    artifact = get_model_artifact()

    # ubah payload ke dataframe agar mudah diproses
    df = pd.DataFrame([r.dict() for r in payload.records])
    
    # warning jika jumlah titik per node kurang dari 30
    counts = df.groupby("node_id").size()
    warnings = [
        f"node_id={node_id} hanya memiliki {count} titik; rekomendasi minimal 30 titik"
        for node_id, count in counts.items()
        if count < 30
    ]
    
    # jalankan inferensi dan feature engineering
    out = predict(df, artifact)

    # kembalikan hanya titik terbaru per node
    latest = out.sort_values(["node_id", "recorded_at"]).groupby("node_id").tail(1)

    results = [
        {
            "node_id": row.node_id,
            "recorded_at": row.recorded_at,
            "score": float(row.score),
            "is_anomaly": int(row.pred_raw),
            "is_anomaly_filtered": int(row.pred_filtered),
        }
        for row in latest.itertuples()
    ]
    return {"results": results, "warnings": warnings}