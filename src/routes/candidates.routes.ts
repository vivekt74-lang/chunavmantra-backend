// routes/candidates.routes.ts - FIXED
import { Router } from 'express';
import pool from '../db.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// GET candidate by ID
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const candidateResult = await pool.query(
            `SELECT 
                c.candidate_id,
                c.candidate_name,
                p.party_id,
                p.party_name,
                p.party_symbol,
                c.age,
                c.gender,
                c.education,
                c.criminal_cases,
                c.assets,
                c.liabilities
            FROM candidates c
            JOIN parties p ON c.party_id = p.party_id
            WHERE c.candidate_id = $1`,
            [id]
        );

        if (candidateResult.rows.length === 0) {
            return next(new AppError('Candidate not found', 404));
        }

        res.json({
            success: true,
            data: candidateResult.rows[0]
        });
    } catch (error) {
        logger.error('Error fetching candidate:', error);
        next(new AppError('Failed to fetch candidate', 500));
    }
});

// GET candidate performance across constituencies - FIXED
router.get('/:id/performance', async (req, res, next) => {
    try {
        const { id } = req.params;
        const electionYear = req.query.election_year || 2022;

        const performanceResult = await pool.query(
            `SELECT 
                ac.ac_name,
                ac.ac_id,
                SUM(br.votes_secured) as total_votes,
                ROUND(
                    (SUM(br.votes_secured) * 100.0 / total_votes_by_constituency.total), 2
                ) as vote_percentage,
                RANK() OVER (ORDER BY SUM(br.votes_secured) DESC) as rank_in_constituency
            FROM booth_results br
            JOIN booths b ON br.booth_id = b.booth_id
            JOIN assembly_constituencies ac ON b.ac_id = ac.ac_id
            JOIN (
                SELECT b2.ac_id, SUM(br2.votes_secured) as total
                FROM booth_results br2
                JOIN booths b2 ON br2.booth_id = b2.booth_id
                WHERE br2.election_id = 1
                GROUP BY b2.ac_id
            ) as total_votes_by_constituency ON b.ac_id = total_votes_by_constituency.ac_id
            WHERE br.candidate_id = $1 AND br.election_id = 1
            GROUP BY ac.ac_name, ac.ac_id, total_votes_by_constituency.total
            ORDER BY SUM(br.votes_secured) DESC`,
            [id]
        );

        const candidateInfo = await pool.query(
            `SELECT 
                c.candidate_name,
                p.party_name,
                p.party_symbol
            FROM candidates c
            JOIN parties p ON c.party_id = p.party_id
            WHERE c.candidate_id = $1`,
            [id]
        );

        res.json({
            success: true,
            data: {
                candidate: candidateInfo.rows[0],
                performance: performanceResult.rows
            }
        });
    } catch (error) {
        logger.error('Error fetching candidate performance:', error);
        next(new AppError('Failed to fetch candidate performance', 500));
    }
});

export default router;