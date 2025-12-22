// middleware/errorHandler.ts
import type { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';

export class AppError extends Error {
    statusCode: number;
    isOperational: boolean;

    constructor(message: string, statusCode: number) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true;

        Error.captureStackTrace(this, this.constructor);
    }
}

export const errorHandler = (
    err: Error | AppError,
    req: Request,
    res: Response,
    next: NextFunction
) => {
    let error = { ...err };
    error.message = err.message;

    // Log error
    logger.error(err);

    // PostgreSQL errors
    if (err.name === 'QueryResultError') {
        error = new AppError('Database query error', 500);
    }

    if (err.name === 'ConnectionError') {
        error = new AppError('Database connection error', 503);
    }

    // Type errors
    if (err.name === 'TypeError') {
        error = new AppError('Type error occurred', 400);
    }

    // Default to 500 server error
    const statusCode = (error as any).statusCode || 500;
    const message = error.message || 'Server Error';

    res.status(statusCode).json({
        success: false,
        error: message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
};