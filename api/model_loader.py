# skrip untuk load model yang sudah dilatih 
# disimpan sebagai artifact agar bisa digunakan di API tanpa perlu load ulang

import os
from pathlib import Path
import joblib

BASE_DIR = Path(__file__).resolve().parents[1]
MODEL_PATH = os.getenv(
    "MODEL_PATH",
    str(BASE_DIR / "ml" / "model" / "isolation_forest.joblib"),
)

_model_artifact = None

# fungsi load model dengan caching agar tidak perlu load ulang setiap kali dipanggil
def get_model_artifact():
    global _model_artifact
    if _model_artifact is None:
        _model_artifact = joblib.load(MODEL_PATH)
    return _model_artifact