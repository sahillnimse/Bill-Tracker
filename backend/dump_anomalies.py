import sqlite3

conn = sqlite3.connect("data/spendwatch.db")
rows = conn.execute(
    "SELECT id, provider, message, date FROM anomaly_history ORDER BY id"
).fetchall()
conn.close()

with open("anomaly_dump.txt", "w") as f:
    f.write(f"total rows: {len(rows)}\n\n")
    for r in rows:
        f.write(f"{r}\n")

print("wrote anomaly_dump.txt with", len(rows), "rows")