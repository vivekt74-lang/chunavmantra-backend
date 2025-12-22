// routes/states.routes.ts - FIXED
import { Router } from 'express';
import pool from '../db.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// GET all states
router.get('/', async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT state_id, state_name FROM public.states ORDER BY state_id ASC'
        );

        res.json({
            success: true,
            data: result.rows,
            count: result.rowCount
        });
    } catch (error) {
        logger.error('Error fetching states:', error);
        next(new AppError('Failed to fetch states', 500));
    }
});

// GET state by ID
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            'SELECT state_id, state_name FROM public.states WHERE state_id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return next(new AppError('State not found', 404));
        }

        res.json({
            success: true,
            data: result.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching state details:', error);
        next(new AppError('Failed to fetch state details', 500));
    }
});

// GET assemblies for a state - FIXED (joins districts table)
router.get('/:id/assemblies', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if state exists
        const stateCheck = await pool.query(
            'SELECT state_id, state_name FROM public.states WHERE state_id = $1',
            [id]
        );

        if (stateCheck.rows.length === 0) {
            return next(new AppError('State not found', 404));
        }

        // Get assemblies with district info - FIXED JOIN
        const result = await pool.query(
            `SELECT 
                ac.ac_id as constituency_id,
                ac.ac_name as constituency_name,
                ac.ac_number,
                d.district_name as district,
                d.district_id,
                s.state_id,
                s.state_name,
                -- Calculate totals from booths
                COALESCE(SUM(bt.total_electors), 0) as total_voters,
                COUNT(DISTINCT b.booth_id) as polling_booths,
                -- Determine category from name
                CASE 
                    WHEN ac.ac_name ILIKE '%(SC)%' THEN 'SC'
                    WHEN ac.ac_name ILIKE '%(ST)%' THEN 'ST'
                    ELSE 'GEN'
                END as category,
                -- Default values for missing columns
                NULL as parliament_seat,
                NULL as area_sqkm,
                CASE 
                    WHEN ac.ac_name ILIKE '%(SC)%' THEN 'SC'
                    WHEN ac.ac_name ILIKE '%(ST)%' THEN 'ST'
                    ELSE NULL
                END as reserved_for
            FROM public.assembly_constituencies ac
            JOIN public.districts d ON ac.district_id = d.district_id
            JOIN public.states s ON d.state_id = s.state_id
            LEFT JOIN public.booths b ON ac.ac_id = b.ac_id
            LEFT JOIN public.booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            WHERE s.state_id = $1
            GROUP BY ac.ac_id, ac.ac_name, ac.ac_number, d.district_name, d.district_id, s.state_id, s.state_name
            ORDER BY ac.ac_number ASC`,
            [id]
        );

        res.json({
            success: true,
            data: result.rows,
            count: result.rowCount
        });
    } catch (error) {
        console.error('Error in /assemblies endpoint:', error);
        logger.error('Error fetching state assemblies:', error);
        next(new AppError('Failed to fetch state assemblies', 500));
    }
});

// GET state statistics
router.get('/:id/stats', async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if state exists
        const stateCheck = await pool.query(
            'SELECT state_id, state_name FROM public.states WHERE state_id = $1',
            [id]
        );

        if (stateCheck.rows.length === 0) {
            return next(new AppError('State not found', 404));
        }

        // Get statistics with proper joins - FIXED
        const stats = await pool.query(
            `SELECT 
                COUNT(DISTINCT ac.ac_id) as total_assemblies,
                COUNT(DISTINCT d.district_id) as total_districts,
                COALESCE(SUM(bt.total_electors), 0) as total_voters,
                COUNT(DISTINCT b.booth_id) as total_booths,
                COALESCE(SUM(bt.total_votes_cast), 0) as total_votes_cast,
                COUNT(DISTINCT c.candidate_id) as total_candidates,
                COUNT(DISTINCT p.party_id) as total_parties
            FROM public.states s
            JOIN public.districts d ON s.state_id = d.state_id
            JOIN public.assembly_constituencies ac ON d.district_id = ac.district_id
            LEFT JOIN public.booths b ON ac.ac_id = b.ac_id
            LEFT JOIN public.booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            LEFT JOIN public.booth_results br ON b.booth_id = br.booth_id AND br.election_id = 1
            LEFT JOIN public.candidates c ON br.candidate_id = c.candidate_id
            LEFT JOIN public.parties p ON c.party_id = p.party_id
            WHERE s.state_id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: {
                state_id: parseInt(id),
                state_name: stateCheck.rows[0].state_name,
                ...stats.rows[0]
            }
        });
    } catch (error) {
        logger.error('Error fetching state statistics:', error);
        next(new AppError('Failed to fetch state statistics', 500));
    }
});

export default router;