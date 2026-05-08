import argparse
from datetime import datetime, timedelta, timezone
from pathlib import Path
import uuid

import numpy as np
import pandas as pd


def make_uuid() -> str:
    return str(uuid.uuid4())


def generate_nodes(n_nodes: int, end_time: datetime, rng: np.random.Generator) -> pd.DataFrame:
    blocks = ["A1", "A2", "B1", "B2", "C1"]
    rows = []
    for _ in range(n_nodes):
        last_sync = end_time - timedelta(minutes=int(rng.integers(1, 60)))
        rows.append(
            {
                "node_id": make_uuid(),
                "location_block": rng.choice(blocks),
                "is_online": bool(rng.random() < 0.9),
                "last_sync": last_sync,
            }
        )
    return pd.DataFrame(rows)


def generate_users(n_users: int, rng: np.random.Generator) -> pd.DataFrame:
    roles = ["admin", "tech", "viewer"]
    weights = [0.2, 0.6, 0.2]
    rows = []
    for i in range(n_users):
        role = rng.choice(roles, p=weights)
        rows.append(
            {
                "user_id": make_uuid(),
                "role": role,
                "email": f"{role}{i+1}@gmail.com",
            }
        )
    return pd.DataFrame(rows)


def generate_anomalies(
    node_ids: list[str],
    start_time: datetime,
    end_time: datetime,
    rng: np.random.Generator,
    max_per_node: int = 2,
    min_minutes: int = 10,
    max_minutes: int = 120,
) -> pd.DataFrame:
    rows = []
    total_minutes = int((end_time - start_time).total_seconds() / 60)
    for node_id in node_ids:
        n = int(rng.integers(0, max_per_node + 1))
        for _ in range(n):
            start_offset = int(rng.integers(0, max(1, total_minutes - min_minutes)))
            start = start_time + timedelta(minutes=start_offset)
            duration = int(rng.integers(min_minutes, max_minutes + 1))
            end = min(start + timedelta(minutes=duration), end_time)
            rows.append(
                {
                    "anomaly_id": make_uuid(),
                    "node_id": node_id,
                    "start_time": start,
                    "end_time": end,
                    "ai_score": float(rng.uniform(0.7, 0.99)),
                    "is_resolved": bool(rng.random() < 0.6),
                }
            )
    return pd.DataFrame(rows)


def generate_telemetry(
    node_ids: list[str],
    start_time: datetime,
    end_time: datetime,
    freq_min: int,
    anomalies_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    times = pd.date_range(start=start_time, end=end_time, freq=f"{freq_min}min", inclusive="left")
    hours = times.hour.to_numpy() + times.minute.to_numpy() / 60.0

    # baseline debit air: rendah di malam hari (1-4 debit/menit), tinggi di siang hari (5-10 debit/menit)
    diurnal = 6 + 4 * np.sin(2 * np.pi * (hours - 6) / 24.0)

    rows = []
    for node_id in node_ids:
        node_bias = float(rng.normal(0, 0.5))
        noise = rng.normal(0, 1.0, size=len(times))
        flow = diurnal + node_bias + noise
        flow = np.clip(flow, 0, None)

        node_anoms = anomalies_df[anomalies_df["node_id"] == node_id]
        for _, row in node_anoms.iterrows():
            mask = (times >= row["start_time"]) & (times <= row["end_time"])
            flow[mask] += int(rng.integers(25, 60))

        flow_rate = np.round(flow).astype(int)

        rows.extend(
            {
                "id": make_uuid(),
                "node_id": node_id,
                "flow_rate_lpm": int(flow_rate[i]),
                "recorded_at": times[i],
            }
            for i in range(len(times))
        )

    return pd.DataFrame(rows)


def generate_incident_logs(
    anomalies_df: pd.DataFrame, users_df: pd.DataFrame, rng: np.random.Generator
) -> pd.DataFrame:
    tech_users = users_df[users_df["role"].isin(["tech", "admin"])]
    if tech_users.empty:
        tech_users = users_df

    actions = [
        "Reset perangkat and konfirmasi flow normal",
        "Telah mengecek nilai dan menutup titik kebocoran",
        "Telah mengecek pipa, tidak ada kebocoran",
        "Mengganti sensor rusak",
    ]

    rows = []
    for _, anomaly in anomalies_df.iterrows():
        if rng.random() < 0.6:
            user_id = rng.choice(tech_users["user_id"].tolist())
            action_time = anomaly["end_time"] + timedelta(minutes=int(rng.integers(5, 240)))
            rows.append(
                {
                    "log_id": make_uuid(),
                    "anomaly_id": anomaly["anomaly_id"],
                    "user_id": user_id,
                    "action_description": rng.choice(actions),
                    "action_timestamp": action_time,
                }
            )

    return pd.DataFrame(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--nodes", type=int, default=5)
    parser.add_argument("--days", type=int, default=7)
    parser.add_argument("--freq-min", type=int, default=1)
    parser.add_argument("--users", type=int, default=10)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=str, default=None)
    parser.add_argument("--max-anoms-per-node", type=int, default=2)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    rng = np.random.default_rng(args.seed)

    end_time = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start_time = end_time - timedelta(days=args.days)

    base_dir = Path(__file__).resolve().parent
    out_dir = Path(args.out_dir) if args.out_dir else base_dir / "data"
    out_dir.mkdir(parents=True, exist_ok=True)

    nodes_df = generate_nodes(args.nodes, end_time, rng)
    users_df = generate_users(args.users, rng)
    anomalies_df = generate_anomalies(
        nodes_df["node_id"].tolist(),
        start_time,
        end_time,
        rng,
        max_per_node=args.max_anoms_per_node,
    )
    telemetry_df = generate_telemetry(
        nodes_df["node_id"].tolist(),
        start_time,
        end_time,
        args.freq_min,
        anomalies_df,
        rng,
    )
    incident_df = generate_incident_logs(anomalies_df, users_df, rng)

    nodes_df.to_csv(out_dir / "nodes.csv", index=False)
    telemetry_df.to_csv(out_dir / "telemetry_data.csv", index=False)
    anomalies_df.to_csv(out_dir / "anomalies.csv", index=False)
    users_df.to_csv(out_dir / "users.csv", index=False)
    incident_df.to_csv(out_dir / "incident_logs.csv", index=False)

    print("Generate dummy data selesai. Jumlah data:")
    print(f"nodes={len(nodes_df)}")
    print(f"telemetry_data={len(telemetry_df)}")
    print(f"anomalies={len(anomalies_df)}")
    print(f"users={len(users_df)}")
    print(f"incident_logs={len(incident_df)}")


if __name__ == "__main__":
    main()