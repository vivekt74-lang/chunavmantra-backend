// db.ts - PostgreSQL connection pool
import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

// Database configuration
const poolConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'chunavmantra',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'admin@123',
    max: 20, // maximum number of clients in the pool
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
    ssl: isProduction ? { rejectUnauthorized: false } : false
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
        process.exit(1);
    });

// Pool event listeners
pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

export default pool;