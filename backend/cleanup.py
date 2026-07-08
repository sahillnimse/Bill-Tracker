import sqlite3

conn = sqlite3.connect("data/spendwatch.db")
conn.execute("DELETE FROM anomaly_history WHERE message LIKE '%(TEST%'")
conn.commit()
print("deleted:", conn.total_changes)
conn.close()