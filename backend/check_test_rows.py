import sqlite3

conn = sqlite3.connect("data/spendwatch.db")
rows = conn.execute(
    "SELECT id, provider, message FROM anomaly_history WHERE message LIKE '%TEST%'"
).fetchall()
if not rows:
    print("no TEST rows remain")
for r in rows:
    print(r)
conn.close()
