# skrip untuk inference/prediksi menggunakan model yang sudah dilatih

from typing import List, Dict, Any
import numpy as np
import pandas as pd

# fungsi untuk membangun fitur dari data mentah
def build_features(df: pd.DataFrame) -> pd.DataFrame:
    df = df.sort_values(["node_id", "recorded_at"]).copy()
    df["flow_rate_lpm"] = df["flow_rate_lpm"].astype(float)

    df["flow_mean_30"] = df.groupby("node_id")["flow_rate_lpm"].transform(
        lambda s: s.rolling(30, min_periods=1).mean()
    )
    df["flow_std_30"] = df.groupby("node_id")["flow_rate_lpm"].transform(
        lambda s: s.rolling(30, min_periods=1).std().fillna(0)
    )
    df["flow_median_30"] = df.groupby("node_id")["flow_rate_lpm"].transform(
        lambda s: s.rolling(30, min_periods=1).median()
    )
    df["flow_max_30"] = df.groupby("node_id")["flow_rate_lpm"].transform(
        lambda s: s.rolling(30, min_periods=1).max()
    )
    df["flow_min_30"] = df.groupby("node_id")["flow_rate_lpm"].transform(
        lambda s: s.rolling(30, min_periods=1).min()
    )
    df["flow_delta"] = df.groupby("node_id")["flow_rate_lpm"].diff().fillna(0)

    safe_std = df["flow_std_30"].replace(0, np.nan)
    df["z_score_30"] = ((df["flow_rate_lpm"] - df["flow_mean_30"]) / safe_std).fillna(0)

    return df

# fungsi untuk melakukan prediksi anomali
def predict(df: pd.DataFrame, artifact: Dict[str, Any]) -> pd.DataFrame:
    feature_cols = artifact["feature_cols"]
    threshold = artifact.get("threshold")
    min_consecutive = artifact.get("post_filtering", {}).get("min_consecutive", 3)

    feats = build_features(df)
    X = feats[feature_cols].to_numpy()

    score = -artifact["model"].decision_function(X)
    if threshold is None:
        pred_raw = (artifact["model"].predict(X) == -1).astype(int)
    else:
        pred_raw = (score >= threshold).astype(int)

    feats["score"] = score
    feats["pred_raw"] = pred_raw

    feats["pred_filtered"] = (
        feats.groupby("node_id")["pred_raw"]
        .transform(
            lambda s: s.rolling(min_consecutive, min_periods=min_consecutive)
            .sum()
            .ge(min_consecutive)
            .astype(int)
        )
        .fillna(0)
        .astype(int)
    )

    return feats