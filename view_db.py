import sqlite3
import pandas as pd

# Connect to database
conn = sqlite3.connect('database/help.db')

# List all tables
cursor = conn.cursor()
cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
tables = cursor.fetchall()
print("\n📊 TABLES:")
for table in tables:
    print(f"   - {table[0]}")

# View members
print("\n👥 MEMBERS:")
df = pd.read_sql_query("SELECT id, full_name, email, status, created_at FROM members", conn)
print(df.to_string())

# View submissions
print("\n📝 SUBMISSIONS:")
df = pd.read_sql_query("SELECT id, full_name, email, status, created_at FROM submissions", conn)
print(df.to_string())

# View payments
print("\n💰 PAYMENTS:")
df = pd.read_sql_query("SELECT id, transaction_id, amount, status, payment_date FROM payments", conn)
print(df.to_string())

conn.close()