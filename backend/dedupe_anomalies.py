import sqlite3

conn = sqlite3.connect("data/spendwatch.db")

# Keep the earliest row (lowest id) for each provider+date+method combo,
# delete the rest.
before = conn.execute("SELECT COUNT(*) FROM anomaly_history").fetchone()[0]

conn.execute("""
    DELETE FROM anomaly_history
    WHERE id NOT IN (
        SELECT MIN(id)
        FROM anomaly_history
        GROUP BY provider, date, method
    )
""")
conn.commit()

after = conn.execute("SELECT COUNT(*) FROM anomaly_history").fetchone()[0]
print(f"before: {before} rows, after: {after} rows, removed: {before - after}")

conn.close()