// routes/elections.routes.ts
import { Router } from 'express';
import pool from '../src/db.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// GET election results by constituency and year
router.get('/results', async (req, res, next) => {
    try {
        const { constituency_id, year } = req.query;
        const electionYear = year || 2022;

        if (!constituency_id) {
            return next(new AppError('Constituency ID is required', 400));
        }

        const results = await pool.query(
            `SELECT 
        ROW_NUMBER() OVER (ORDER BY SUM(br.votes_secured) DESC) as rank,
        c.candidate_name,
        p.party_symbol,
        p.party_name,
        SUM(br.votes_secured) as votes,
        ROUND(
          (SUM(br.votes_secured) * 100.0 / total_votes.total), 2
        ) as percentage
       FROM booth_results br
       JOIN booths b ON br.booth_id = b.booth_id
       JOIN candidates c ON br.candidate_id = c.candidate_id
       JOIN parties p ON c.party_id = p.party_id
       CROSS JOIN (
         SELECT SUM(votes_secured) as total
         FROM booth_results br2
         JOIN booths b2 ON br2.booth_id = b2.booth_id
         WHERE b2.ac_id = $1 AND br2.election_id = $2
       ) as total_votes
       WHERE b.ac_id = $1 AND br.election_id = $2
       GROUP BY c.candidate_name, p.party_symbol, p.party_name, total_votes.total
       ORDER BY SUM(br.votes_secured) DESC`,
            [constituency_id, electionYear]
        );

        res.json({
            success: true,
            data: results.rows,
            election_year: electionYear
        });
    } catch (error) {
        logger.error('Error fetching election results:', error);
        next(new AppError('Failed to fetch election results', 500));
    }
});

// GET historical vote share trend
router.get('/vote-share-trend', async (req, res, next) => {
    try {
        const { constituency_id } = req.query;

        if (!constituency_id) {
            return next(new AppError('Constituency ID is required', 400));
        }

        const trendData = await pool.query(
            `SELECT 
        e.election_year,
        p.party_symbol,
        p.party_name,
        SUM(br.votes_secured) as total_votes,
        ROUND(
          (SUM(br.votes_secured) * 100.0 / total_votes_by_year.total), 2
        ) as vote_percentage
       FROM elections e
       JOIN booth_results br ON e.election_id = br.election_id
       JOIN booths b ON br.booth_id = b.booth_id
       JOIN candidates c ON br.candidate_id = c.candidate_id
       JOIN parties p ON c.party_id = p.party_id
       JOIN (
         SELECT e2.election_id, SUM(br2.votes_secured) as total
         FROM elections e2
         JOIN booth_results br2 ON e2.election_id = br2.election_id
         JOIN booths b2 ON br2.booth_id = b2.booth_id
         WHERE b2.ac_id = $1
         GROUP BY e2.election_id
       ) as total_votes_by_year ON e.election_id = total_votes_by_year.election_id
       WHERE b.ac_id = $1
       GROUP BY e.election_year, p.party_symbol, p.party_name, total_votes_by_year.total
       ORDER BY e.election_year DESC, SUM(br.votes_secured) DESC`,
            [constituency_id]
        );

        // Format data for chart
        const formattedData = trendData.rows.reduce((acc, row) => {
            const year = row.election_year;
            if (!acc[year]) {
                acc[year] = {
                    year,
                    parties: {}
                };
            }
            acc[year].parties[row.party_symbol] = {
                name: row.party_name,
                votes: row.total_votes,
                percentage: row.vote_percentage
            };
            return acc;
        }, {});

        res.json({
            success: true,
            data: Object.values(formattedData),
            parties: [...new Set(trendData.rows.map(row => row.party_symbol))]
        });
    } catch (error) {
        logger.error('Error fetching vote share trend:', error);
        next(new AppError('Failed to fetch vote share trend', 500));
    }
});

// GET turnout trend
router.get('/turnout-trend', async (req, res, next) => {
    try {
        const { constituency_id } = req.query;

        if (!constituency_id) {
            return next(new AppError('Constituency ID is required', 400));
        }

        const turnoutTrend = await pool.query(
            `SELECT 
        e.election_year,
        SUM(bt.total_votes_cast) as total_votes,
        SUM(bt.total_electors) as total_electors,
        ROUND(
          (SUM(bt.total_votes_cast) * 100.0 / SUM(bt.total_electors)), 2
        ) as turnout_percentage
       FROM elections e
       JOIN booth_turnout bt ON e.election_id = bt.election_id
       JOIN booths b ON bt.booth_id = b.booth_id
       WHERE b.ac_id = $1
       GROUP BY e.election_year
       ORDER BY e.election_year`,
            [constituency_id]
        );

        res.json({
            success: true,
            data: turnoutTrend.rows
        });
    } catch (error) {
        logger.error('Error fetching turnout trend:', error);
        next(new AppError('Failed to fetch turnout trend', 500));
    }
});

export default router;