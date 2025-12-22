// db.ts - PostgreSQL connection pool
import pg from 'pg';
const { Pool } = pg;
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Render provides a DATABASE_URL. If it's missing (local dev),
 * it falls back to your local credentials.
 */
const poolConfig = process.env.DATABASE_URL
    ? {
        connectionString: process.env.DATABASE_URL,
        ssl: isProduction ? { rejectUnauthorized: false } : false
    }
    : {
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'chunavmantra',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'admin@123',
        ssl: false
    };

const pool = new Pool(poolConfig);

// Test connection on startup
pool.connect()
    .then(client => {
        console.log('✅ PostgreSQL connected successfully');
        client.release();
    })
    .catch(err => {
        console.error('❌ PostgreSQL connection error:', err.message);
        if (isProduction) process.exit(1);
    });

export default pool;