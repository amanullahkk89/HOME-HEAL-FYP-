import mysql from 'mysql2/promise';

let pool: mysql.Pool | null = null;

/**
 * Returns a configured MySQL 8.0 connection pool when DB_CLIENT=mysql.
 * Queries always use parameterized placeholders (?) to prevent SQL injection.
 */
export function getMySqlPool(): mysql.Pool | null {
  if (process.env.DB_CLIENT !== 'mysql') {
    return null;
  }
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: Number(process.env.MYSQL_PORT || 3306),
      user: process.env.MYSQL_USER || 'homeheal_app',
      password: process.env.MYSQL_PASSWORD || '',
      database: process.env.MYSQL_DATABASE || 'homeheal_east_city',
      waitForConnections: true,
      connectionLimit: 10,
      namedPlaceholders: false,
      timezone: 'Z',
    });
  }
  return pool;
}

export async function verifyMySqlConnectivity(): Promise<{ connected: boolean; detail: string }> {
  const mysqlPool = getMySqlPool();
  if (!mysqlPool) {
    return {
      connected: false,
      detail: 'Embedded transactional SQLite mirror active (set DB_CLIENT=mysql for MySQL 8.0).',
    };
  }
  try {
    await mysqlPool.query('SELECT 1');
    return { connected: true, detail: 'Connected to MySQL 8.0 pool.' };
  } catch (err) {
    return {
      connected: false,
      detail: err instanceof Error ? err.message : 'MySQL connection check failed.',
    };
  }
}
