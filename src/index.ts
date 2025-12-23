// server.ts - Fixed CORS configuration
import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pool from './db.js';
import dotenv from 'dotenv';
import { errorHandler } from '../src/middleware/errorHandler.js';
import { logger } from '../src/utils/logger.js';

// Routes
import stateRoutes from '../src/routes/states.routes.js';
import constituencyRoutes from '../src/routes/constituencies.routes.js';
import electionRoutes from '../src/routes/elections.routes.js';
import boothRoutes from '../src/routes/booths.routes.js';
import candidateRoutes from '../src/routes/candidates.routes.js';
import boothAnalysisRoutes from '../src/routes/booth-analysis.routes.js'

// Load environment variables FIRST
dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 5000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const isProduction = NODE_ENV === 'production';

// Validate required environment variables
const requiredEnvVars: string[] = [];

if (isProduction) {
    requiredEnvVars.push('DATABASE_URL', 'FRONTEND_URL');
}


const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
    logger.error(`Missing required environment variables: ${missingEnvVars.join(', ')}`);
    if (isProduction) {
        process.exit(1);
    }
}

// Security middleware - Simplified Helmet config
const getHelmetConfig = () => {
    if (isProduction) {
        // Production helmet config
        const cspDirectives = {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            fontSrc: ["'self'", "https:"],
            connectSrc: [
                "'self'",
                ...process.env.FRONTEND_URL.split(','),
                "https://*.onrender.com"
            ],
            objectSrc: ["'none'"],
            mediaSrc: ["'self'"],
            frameSrc: ["'none'"],
        };

        // Return production config with proper Helmet options structure
        return {
            contentSecurityPolicy: {
                directives: cspDirectives,
            },
            crossOriginEmbedderPolicy: true,
            crossOriginOpenerPolicy: { policy: "same-origin" },
            crossOriginResourcePolicy: { policy: "same-site" },
            dnsPrefetchControl: { allow: false },
            frameguard: { action: "deny" },
            hsts: {
                maxAge: 31536000,
                includeSubDomains: true,
                preload: true
            },
            referrerPolicy: { policy: "strict-origin-when-cross-origin" },
            hidePoweredBy: true,
            noSniff: true,
            xssFilter: true,
        };
    } else {
        // Development helmet config (more relaxed)
        return {
            contentSecurityPolicy: false,
            crossOriginEmbedderPolicy: false,
        };
    }
};

// Apply helmet with appropriate config
const helmetConfig = getHelmetConfig();
app.use(helmet(helmetConfig as any)); // Type assertion for Helmet options

// FIXED CORS CONFIGURATION - ADD 8080
const corsOptions = {
    origin: (origin: string | undefined, callback: Function) => {
        if (!origin) return callback(null, true); // health checks, SSR

        if (ALLOWED_ORIGINS.includes(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
};



// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests for all routes
app.options('*', cors(corsOptions));

// Rate limiting - different for production vs development
const getRateLimitConfig = () => {
    const baseConfig = {
        windowMs: 15 * 60 * 1000, // 15 minutes
        standardHeaders: true,
        legacyHeaders: false,
        skipSuccessfulRequests: false,
        skip: (req: Request) => req.path === '/health' || req.path === '/api/test',
        handler: (req: Request, res: Response) => {
            logger.warn(`Rate limit exceeded for IP: ${req.ip}`);
            res.status(429).json({
                error: 'Too many requests',
                message: 'Too many requests from this IP, please try again later.',
                retryAfter: 15 * 60 // 15 minutes in seconds
            });
        }
    };

    if (isProduction) {
        return {
            ...baseConfig,
            max: 100, // limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP, please try again later.'
        };
    } else {
        return {
            ...baseConfig,
            max: 1000, // limit each IP to 1000 requests per windowMs in development
        };
    }
};

const limiter = rateLimit(getRateLimitConfig());

// Apply rate limiting to API routes only
app.use('/api/', limiter);

// Body parsing with limits
app.use(express.json({
    limit: '10mb',
    strict: true,
    type: ['application/json', 'application/*+json']
}));

app.use(express.urlencoded({
    extended: true,
    limit: '10mb',
    parameterLimit: 50,
    type: 'application/x-www-form-urlencoded'
}));

// Compression
app.use(compression({
    level: 6,
    threshold: 1024, // Only compress responses larger than 1KB
    filter: (req: Request, res: Response) => {
        if (req.headers['x-no-compression']) {
            return false;
        }
        return compression.filter(req, res);
    }
}));

// Custom request logging middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Log after response is finished
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.info({
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            contentLength: res.get('Content-Length') || 0
        });
    });

    next();
});

// Additional security headers middleware
app.use((req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');

    // Prevent MIME type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Set Referrer-Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Set Permissions-Policy (Feature-Policy)
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // ADD MANUAL CORS HEADERS AS BACKUP
    const allowedOrigins = ['http://localhost:8080', 'http://localhost:5173'];
    const origin = req.headers.origin;


    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Origin, X-Requested-With');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Max-Age', '86400');

    next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
    const healthCheck = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: NODE_ENV,
        service: 'Election Data API',
        version: process.env.npm_package_version || '1.0.0',
        nodeVersion: process.version,
        cors: {
            allowedOrigins: corsOptions.origin,
            frontendUrl: process.env.FRONTEND_URL
        }
    };

    res.status(200).json(healthCheck);
});

// Database connection test endpoint
app.get('/api/test', async (req: Request, res: Response, next: NextFunction) => {
    try {
        const result = await pool.query(`
            SELECT 
                NOW() as server_time,
                version() as postgres_version,
                (SELECT count(*) FROM pg_stat_activity) as active_connections,
                (SELECT setting FROM pg_settings WHERE name = 'max_connections') as max_connections
        `);

        const dbInfo = result.rows[0];

        res.json({
            message: "Connected to PostgreSQL database",
            database: {
                serverTime: dbInfo.server_time,
                version: dbInfo.postgres_version,
                connections: {
                    active: parseInt(dbInfo.active_connections),
                    max: parseInt(dbInfo.max_connections)
                }
            },
            environment: NODE_ENV,
            memoryUsage: process.memoryUsage()
        });
    } catch (err: any) {
        logger.error('Database connection error:', err);
        next(err); // Pass to error handler
    }
});

// API Routes
app.use('/api/states', stateRoutes);
app.use('/api/constituencies', constituencyRoutes);
app.use('/api/elections', electionRoutes);
app.use('/api/booths', boothRoutes);
app.use('/api/candidates', candidateRoutes);
app.use('/api/booth-analysis', boothAnalysisRoutes);

// API Documentation endpoint (optional)
app.get('/api', (req: Request, res: Response) => {
    res.json({
        name: 'Election Data API',
        version: '1.0.0',
        endpoints: {
            states: '/api/states',
            constituencies: '/api/constituencies',
            elections: '/api/elections',
            booths: '/api/booths',
            candidates: '/api/candidates'
        },
        documentation: process.env.API_DOCS_URL || 'https://docs.example.com'
    });
});

// 404 handler - must be before error handler
app.use('*', (req: Request, res: Response) => {
    logger.warn(`404 Not Found: ${req.method} ${req.originalUrl} from IP: ${req.ip}`);

    res.status(404).json({
        error: 'Not Found',
        message: `Cannot ${req.method} ${req.originalUrl}`,
        timestamp: new Date().toISOString(),
        path: req.originalUrl
    });
});

// Error handling middleware (must be last)
app.use(errorHandler);

// Start server only if not in test environment
let server: any;

if (process.env.NODE_ENV !== 'test') {
    server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`🚀 Server running on port ${PORT} in ${NODE_ENV} mode`);
        logger.info(`📊 Health check: http://localhost:${PORT}/health`);
        logger.info(`🔗 API Base URL: http://localhost:${PORT}/api`);
        logger.info(`🌍 Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);
        logger.info(`🌍 CORS Allowed Origins: ${ALLOWED_ORIGINS.join(', ')}`);
        logger.info(`📝 Log level: ${process.env.LOG_LEVEL || 'info'}`);
    });

    // Handle server errors
    server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
            logger.error(`Port ${PORT} is already in use`);
            process.exit(1);
        } else {
            logger.error('Server error:', error);
            throw error;
        }
    });

    // Graceful shutdown
    const gracefulShutdown = (signal: string) => {
        logger.info(`${signal} signal received: starting graceful shutdown`);

        server.close(async () => {
            logger.info('HTTP server closed');

            try {
                await pool.end();
                logger.info('Database pool closed');
                process.exit(0);
            } catch (err) {
                logger.error('Error during database pool shutdown:', err);
                process.exit(1);
            }
        });

        // Force shutdown after 10 seconds if graceful shutdown fails
        setTimeout(() => {
            logger.error('Forcing shutdown after timeout');
            process.exit(1);
        }, 10000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
        logger.error('Uncaught Exception:', error);
        gracefulShutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
        logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
        gracefulShutdown('UNHANDLED_REJECTION');
    });
}

export default app;