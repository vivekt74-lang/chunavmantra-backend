// index.ts – Application entry point

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';

import pool from './db.js';
import { errorHandler } from './middleware/errorHandler.js';
import { logger } from './utils/logger.js';

// Routes
import stateRoutes from './routes/states.routes.js';
import constituencyRoutes from './routes/constituencies.routes.js';
import electionRoutes from './routes/elections.routes.js';
import boothRoutes from './routes/booths.routes.js';
import candidateRoutes from './routes/candidates.routes.js';
import boothAnalysisRoutes from './routes/booth-analysis.routes.js';

// Load env FIRST
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

/* =======================
   Allowed Origins (SSOT)
======================= */
const ALLOWED_ORIGINS: string[] = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(',').map(o => o.trim())
    : [];

if (!isProduction && ALLOWED_ORIGINS.length === 0) {
    ALLOWED_ORIGINS.push(
        'http://localhost:5173',
        'http://localhost:8080'
    );
}

/* =======================
   Validate env vars
======================= */
if (isProduction) {
    const required = ['DATABASE_URL', 'FRONTEND_URL'];
    const missing = required.filter(v => !process.env[v]);

    if (missing.length) {
        logger.error(`Missing env vars: ${missing.join(', ')}`);
        process.exit(1);
    }
}

/* =======================
   Security (Helmet)
======================= */
app.use(
    helmet(
        isProduction
            ? {
                contentSecurityPolicy: {
                    directives: {
                        defaultSrc: ["'self'"],
                        styleSrc: ["'self'", "'unsafe-inline'"],
                        scriptSrc: ["'self'"],
                        imgSrc: ["'self'", 'data:', 'https:'],
                        fontSrc: ["'self'", 'https:'],
                        connectSrc: ["'self'", ...ALLOWED_ORIGINS, 'https://*.onrender.com'],
                        objectSrc: ["'none'"],
                        frameSrc: ["'none'"]
                    }
                }
            }
            : { contentSecurityPolicy: false }
    )
);

/* =======================
   CORS
======================= */
const corsOptions: cors.CorsOptions = {
    origin: (origin, callback) => {
        if (!origin) return callback(null, true);

        if (ALLOWED_ORIGINS.includes(origin)) {
            return callback(null, true);
        }

        logger.warn(`CORS blocked: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

/* =======================
   Rate limiting
======================= */
app.use(
    '/api',
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: isProduction ? 100 : 1000,
        standardHeaders: true,
        legacyHeaders: false
    })
);

/* =======================
   Body + compression
======================= */
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(compression());

/* =======================
   Request logging
======================= */
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        logger.info({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${Date.now() - start}ms`
        });
    });
    next();
});

/* =======================
   Health check
======================= */
app.get('/health', (_req, res) => {
    res.json({
        status: 'ok',
        env: NODE_ENV,
        uptime: process.uptime(),
        cors: ALLOWED_ORIGINS
    });
});

/* =======================
   Routes
======================= */
app.use('/api/states', stateRoutes);
app.use('/api/constituencies', constituencyRoutes);
app.use('/api/elections', electionRoutes);
app.use('/api/booths', boothRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/booth-analysis', boothAnalysisRoutes);

/* =======================
   404
======================= */
app.use('*', (req, res) => {
    res.status(404).json({ error: 'Not Found', path: req.originalUrl });
});

/* =======================
   Error handler
======================= */
app.use(errorHandler);

/* =======================
   Start server
======================= */
if (process.env.NODE_ENV !== 'test') {
    app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 Server running on ${PORT} (${NODE_ENV})`);
        logger.info(`🌍 CORS: ${ALLOWED_ORIGINS.join(', ')}`);
    });
}

export default app;
