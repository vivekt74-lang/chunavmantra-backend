// routes/booths.routes.ts - FINAL FIXED VERSION
import { Router } from 'express';
import pool from '../src/db.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// ========== SPECIAL ROUTES ==========

// DATABASE CONNECTION TEST
router.get('/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT NOW() as current_time, version() as db_version');

        res.json({
            success: true,
            database: {
                connected: true,
                time: result.rows[0].current_time,
                version: result.rows[0].db_version
            },
            environment: {
                node: process.version,
                platform: process.platform
            }
        });
    } catch (error: any) {
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// SUPER SIMPLE TEST ENDPOINT
router.get('/test/:id', async (req, res) => {
    try {
        console.log('Testing booth endpoint for ID:', req.params.id);

        const test = await pool.query('SELECT booth_id, booth_number FROM booths WHERE booth_id = $1', [req.params.id]);

        res.json({
            success: true,
            message: 'Test endpoint working',
            booth_data: test.rows,
            request_id: req.params.id,
            timestamp: new Date().toISOString()
        });
    } catch (error: any) {
        console.error('Test endpoint error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            stack: error.stack
        });
    }
});

// ========== MAIN ENDPOINTS ==========

// GET all booths for a constituency
router.get('/constituency/:acId', async (req, res, next) => {
    try {
        const { acId } = req.params;

        const boothsQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                ROUND(
                    (COALESCE(bt.total_votes_cast, 0) * 100.0 / NULLIF(bt.total_electors, 0)), 2
                ) as turnout_percentage
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            WHERE b.ac_id = $1
            ORDER BY CAST(b.booth_number AS INTEGER)
        `, [acId]);

        res.json({
            success: true,
            data: boothsQuery.rows
        });
    } catch (error: any) {
        logger.error('Error fetching constituency booths:', error);
        next(new AppError('Failed to fetch booths', 500));
    }
});

// GET booth results (working endpoint)
router.get('/:id/results', async (req, res, next) => {
    try {
        const { id } = req.params;

        const results = await pool.query(`
            SELECT 
                c.candidate_name,
                p.party_name,
                p.party_symbol,
                br.votes_secured as votes,
                ROUND(
                    (br.votes_secured * 100.0 / NULLIF(bt.total_votes_cast, 0)), 2
                ) as vote_percentage
            FROM booth_results br
            JOIN candidates c ON br.candidate_id = c.candidate_id
            JOIN parties p ON c.party_id = p.party_id
            JOIN booth_turnout bt ON br.booth_id = bt.booth_id AND br.election_id = bt.election_id
            WHERE br.booth_id = $1 AND br.election_id = 1
            ORDER BY br.votes_secured DESC
        `, [id]);

        res.json({
            success: true,
            data: results.rows
        });
    } catch (error: any) {
        logger.error('Error fetching booth results:', error);
        next(new AppError('Failed to fetch booth results', 500));
    }
});

// ========== MAIN BOOTH DETAILS ENDPOINT ==========

// GET booth details by ID - FIXED BASED ON YOUR ACTUAL DB SCHEMA
router.get('/:id', async (req, res, next) => {
    console.log('=== BOOTH DETAILS ENDPOINT CALLED ===');
    console.log('Booth ID:', req.params.id);

    try {
        const { id } = req.params;

        // Validate booth ID
        const boothId = parseInt(id);
        if (isNaN(boothId) || boothId <= 0) {
            return next(new AppError('Invalid booth ID. Must be a positive number.', 400));
        }

        console.log('STEP 1: Getting booth and turnout info...');
        // Get booth info with turnout data
        const boothQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                b.ac_id,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                COALESCE(bt.male_voters, 0) as male_voters,
                COALESCE(bt.female_voters, 0) as female_voters,
                COALESCE(bt.other_voters, 0) as other_voters,
                ROUND(
                    (COALESCE(bt.total_votes_cast, 0) * 100.0 / NULLIF(bt.total_electors, 0)), 2
                ) as turnout_percentage
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            WHERE b.booth_id = $1
        `, [boothId]);

        if (boothQuery.rows.length === 0) {
            console.log('Booth not found in database');
            return next(new AppError('Booth not found', 404));
        }

        const boothData = boothQuery.rows[0];
        console.log('Booth data with turnout:', boothData);

        console.log('STEP 2: Getting constituency info...');
        // Get constituency info
        const constituencyQuery = await pool.query(`
            SELECT 
                a.ac_name,
                a.ac_number,
                d.district_name,
                s.state_name
            FROM assembly_constituencies a
            JOIN districts d ON a.district_id = d.district_id
            JOIN states s ON d.state_id = s.state_id
            WHERE a.ac_id = $1
        `, [boothData.ac_id]);

        const constituency = constituencyQuery.rows[0] || {
            ac_name: 'Unknown',
            ac_number: '0',
            district_name: 'Unknown',
            state_name: 'Unknown'
        };
        console.log('Constituency data:', constituency);

        console.log('STEP 3: Getting booth results...');
        // Get booth results
        const resultsQuery = await pool.query(`
            SELECT 
                c.candidate_name,
                p.party_name,
                p.party_symbol,
                COALESCE(br.votes_secured, 0) as votes_secured
            FROM booth_results br
            JOIN candidates c ON br.candidate_id = c.candidate_id
            JOIN parties p ON c.party_id = p.party_id
            WHERE br.booth_id = $1 AND br.election_id = 1
            ORDER BY br.votes_secured DESC
        `, [boothId]);

        let results = resultsQuery.rows;
        console.log('Raw results count:', results.length);

        // Calculate total votes (use from turnout or sum results)
        const totalVotes = boothData.total_votes_cast || results.reduce((sum: number, r: any) => sum + (r.votes_secured || 0), 0);
        console.log('Total votes:', totalVotes);

        // Calculate percentages and add rank
        results = results.map((result: any, index: number) => {
            const votePercentage = totalVotes > 0
                ? parseFloat(((result.votes_secured * 100) / totalVotes).toFixed(2))
                : 0;

            return {
                ...result,
                vote_percentage: votePercentage,
                rank: index + 1
            };
        });
        console.log('Processed results:', results.slice(0, 3)); // Log first 3

        console.log('STEP 4: Getting constituency stats...');
        // Get constituency stats for comparison
        const statsQuery = await pool.query(`
            SELECT 
                COUNT(DISTINCT b.booth_id) as total_booths,
                ROUND(AVG(COALESCE(bt.total_electors, 0))) as avg_voters,
                ROUND(AVG(
                    (COALESCE(bt.total_votes_cast, 0) * 100.0 / NULLIF(bt.total_electors, 0))
                ), 2) as avg_turnout
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            WHERE b.ac_id = $1
        `, [boothData.ac_id]);

        const stats = statsQuery.rows[0] || { total_booths: 0, avg_voters: 0, avg_turnout: 0 };
        console.log('Constituency stats:', stats);

        // Prepare final response
        const response = {
            success: true,
            data: {
                booth: {
                    booth_id: boothData.booth_id,
                    booth_number: boothData.booth_number,
                    booth_name: boothData.booth_name,
                    total_electors: boothData.total_electors,
                    male_voters: boothData.male_voters,
                    female_voters: boothData.female_voters,
                    other_voters: boothData.other_voters,
                    location_lat: 0,
                    location_long: 0,
                    ac_id: boothData.ac_id,
                    ac_name: constituency.ac_name,
                    ac_number: constituency.ac_number,
                    district_name: constituency.district_name,
                    state_name: constituency.state_name,
                    total_votes_cast: boothData.total_votes_cast,
                    turnout_percentage: boothData.turnout_percentage,
                    constituency_avg_voters: stats.avg_voters || 0,
                    constituency_turnout: stats.avg_turnout || 0,
                    total_booths_in_constituency: stats.total_booths || 0,
                    voter_density: boothData.total_electors > 1000 ? 'Very High' :
                        boothData.total_electors > 800 ? 'High' :
                            boothData.total_electors > 500 ? 'Medium' : 'Low'
                },
                results: results,
                summary: {
                    total_candidates: results.length,
                    total_votes: totalVotes,
                    winning_votes: results[0]?.votes_secured || 0,
                    winning_percentage: results[0]?.vote_percentage || 0,
                    margin_votes: results.length > 1 ? (results[0]?.votes_secured || 0) - (results[1]?.votes_secured || 0) : 0
                }
            }
        };

        console.log('=== RESPONSE SENT SUCCESSFULLY ===');
        console.log('Response prepared successfully');

        res.json(response);

    } catch (error: any) {
        console.error('=== ERROR IN BOOTH DETAILS ENDPOINT ===');
        console.error('Error name:', error.name);
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);

        if (error.code) {
            console.error('PostgreSQL error code:', error.code);
        }

        logger.error('Error fetching booth details:', error);
        next(new AppError('Failed to fetch booth details: ' + error.message, 500));
    }
});

export default router;