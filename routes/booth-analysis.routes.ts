// backend/routes/booth-analysis.routes.ts - COMPLETELY FIXED
import { Router } from 'express';
import pool from '../src/db.js';
import { logger } from '../utils/logger.js';
import { AppError } from '../middleware/errorHandler.js';

const router = Router();

// Test endpoint
router.get('/test', (req, res) => {
    res.json({
        success: true,
        message: 'Booth analysis API is working!',
        timestamp: new Date().toISOString()
    });
});

// 1. FIXED: Booth Analysis for Constituency
router.get('/constituency/:acId/booth-analysis', async (req, res, next) => {
    try {
        const { acId } = req.params;
        const electionId = 1;

        console.log(`Analyzing booths for constituency ${acId}`);

        // FIXED: Simplified query without nested aggregates
        const analysisQuery = await pool.query(`
            WITH booth_stats AS (
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
                    CASE 
                        WHEN bt.total_electors > 0 
                        THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                        ELSE 0 
                    END as turnout_percentage
                FROM booths b
                LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
                WHERE b.ac_id = $1
            ),
            booth_winners AS (
                SELECT 
                    br.booth_id,
                    p.party_name as winning_party,
                    br.votes_secured as winning_votes
                FROM booth_results br
                JOIN candidates c ON br.candidate_id = c.candidate_id
                JOIN parties p ON c.party_id = p.party_id
                WHERE br.election_id = $2
                AND br.votes_secured = (
                    SELECT MAX(votes_secured)
                    FROM booth_results br2
                    WHERE br2.booth_id = br.booth_id
                    AND br2.election_id = $2
                )
            )
            SELECT 
                bs.*,
                bw.winning_party,
                bw.winning_votes,
                -- Get top 3 parties for each booth
                (
                    SELECT json_agg(json_build_object(
                        'party_name', p2.party_name,
                        'votes', sub.votes,
                        'percentage', CASE 
                            WHEN bs.total_votes_cast > 0 
                            THEN ROUND((sub.votes * 100.0 / bs.total_votes_cast)::numeric, 2)
                            ELSE 0 
                        END
                    ) ORDER BY sub.votes DESC)
                    FROM (
                        SELECT 
                            p2.party_name,
                            SUM(br2.votes_secured) as votes
                        FROM booth_results br2
                        JOIN candidates c2 ON br2.candidate_id = c2.candidate_id
                        JOIN parties p2 ON c2.party_id = p2.party_id
                        WHERE br2.booth_id = bs.booth_id AND br2.election_id = $2
                        GROUP BY p2.party_name
                        ORDER BY SUM(br2.votes_secured) DESC
                        LIMIT 3
                    ) sub
                ) as top_parties
            FROM booth_stats bs
            LEFT JOIN booth_winners bw ON bs.booth_id = bw.booth_id
            ORDER BY bs.booth_number::integer
        `, [acId, electionId]);

        // Get constituency summary - FIXED: No nested aggregates
        const summaryQuery = await pool.query(`
            WITH turnout_calc AS (
                SELECT 
                    CASE 
                        WHEN bt.total_electors > 0 
                        THEN (bt.total_votes_cast * 100.0 / bt.total_electors)
                        ELSE 0 
                    END as turnout_rate
                FROM booths b
                LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
                WHERE b.ac_id = $1
            )
            SELECT 
                COUNT(DISTINCT b.booth_id) as total_booths,
                COALESCE(SUM(bt.total_electors), 0) as total_electors,
                COALESCE(SUM(bt.total_votes_cast), 0) as total_votes_cast,
                CASE 
                    WHEN COUNT(t.turnout_rate) > 0 
                    THEN ROUND(AVG(t.turnout_rate)::numeric, 2)
                    ELSE 0 
                END as avg_turnout
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
            CROSS JOIN turnout_calc t
            WHERE b.ac_id = $1
            GROUP BY b.ac_id
        `, [acId, electionId]);

        // Get party dominance - FIXED: Added proper table alias
        const partyDominanceQuery = await pool.query(`
            SELECT 
                p.party_name,
                COUNT(DISTINCT br.booth_id) as booths_won,
                SUM(br.votes_secured) as total_votes
            FROM booth_results br
            JOIN candidates c ON br.candidate_id = c.candidate_id
            JOIN parties p ON c.party_id = p.party_id
            WHERE br.election_id = $2
            AND br.booth_id IN (SELECT booth_id FROM booths WHERE ac_id = $1)
            AND br.votes_secured = (
                SELECT MAX(votes_secured)
                FROM booth_results br2
                WHERE br2.booth_id = br.booth_id
                AND br2.election_id = $2
            )
            GROUP BY p.party_name
            ORDER BY booths_won DESC
        `, [acId, electionId]);

        const analysisData = analysisQuery.rows;
        const summary = summaryQuery.rows[0] || {};
        const partyDominance = partyDominanceQuery.rows;

        // Calculate insights
        const insights = {
            high_turnout_booths: analysisData.filter(b => b.turnout_percentage >= 70).length,
            low_turnout_booths: analysisData.filter(b => b.turnout_percentage < 50).length,
            large_booths: analysisData.filter(b => b.total_electors > 1000).length,
            leading_party: partyDominance[0]?.party_name || 'None',
            total_booths_analyzed: analysisData.length
        };

        res.json({
            success: true,
            data: {
                booths: analysisData,
                party_dominance: partyDominance,
                summary: summary,
                insights: insights
            }
        });

    } catch (error: any) {
        console.error('Error in booth analysis:', error);
        next(new AppError('Failed to fetch booth analysis: ' + error.message, 500));
    }
});

// 2. FIXED: Party Performance
router.get('/party-performance/:acId/:partyName', async (req, res, next) => {
    try {
        const { acId, partyName } = req.params;
        const electionId = 1;

        const performanceQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                br.votes_secured as party_votes,
                bt.total_votes_cast,
                CASE 
                    WHEN bt.total_votes_cast > 0 
                    THEN ROUND((br.votes_secured * 100.0 / bt.total_votes_cast)::numeric, 2)
                    ELSE 0 
                END as vote_share,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as booth_turnout,
                -- Check if party won
                CASE WHEN br.votes_secured = (
                    SELECT MAX(votes_secured)
                    FROM booth_results br2
                    WHERE br2.booth_id = b.booth_id
                    AND br2.election_id = $3
                ) THEN true ELSE false END as is_winner
            FROM booth_results br
            JOIN candidates c ON br.candidate_id = c.candidate_id
            JOIN parties p ON c.party_id = p.party_id
            JOIN booths b ON br.booth_id = b.booth_id
            JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $3
            WHERE b.ac_id = $1 
            AND p.party_name = $2
            AND br.election_id = $3
            ORDER BY br.votes_secured DESC
        `, [acId, partyName, electionId]);

        const performance = performanceQuery.rows;

        res.json({
            success: true,
            data: {
                party_name: partyName,
                booths_contested: performance.length,
                booths_won: performance.filter(p => p.is_winner).length,
                total_votes: performance.reduce((sum, b) => sum + b.party_votes, 0),
                avg_vote_share: performance.length > 0
                    ? performance.reduce((sum, b) => sum + b.vote_share, 0) / performance.length
                    : 0,
                performance: performance
            }
        });

    } catch (error: any) {
        console.error('Error in party performance:', error);
        next(new AppError('Failed to fetch party performance', 500));
    }
});

// 3. FIXED: Booth Clusters (Simplified)
router.get('/clusters/:acId', async (req, res, next) => {
    try {
        const { acId } = req.params;
        const electionId = 1;

        const clustersQuery = await pool.query(`
            WITH booth_features AS (
                SELECT 
                    b.booth_id,
                    b.booth_number,
                    b.booth_name,
                    COALESCE(bt.total_electors, 0) as total_electors,
                    COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                    CASE 
                        WHEN bt.total_electors > 0 
                        THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                        ELSE 0 
                    END as turnout,
                    ROUND((COALESCE(bt.male_voters, 0) * 100.0 / NULLIF(bt.total_electors, 1))::numeric, 2) as male_percentage,
                    ROUND((COALESCE(bt.female_voters, 0) * 100.0 / NULLIF(bt.total_electors, 1))::numeric, 2) as female_percentage
                FROM booths b
                LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
                WHERE b.ac_id = $1
            )
            SELECT 
                CASE 
                    WHEN turnout >= 70 AND total_electors > 800 THEN 'High_Turnout_Large'
                    WHEN turnout >= 70 AND total_electors <= 800 THEN 'High_Turnout_Small'
                    WHEN turnout >= 50 AND total_electors > 800 THEN 'Medium_Turnout_Large'
                    WHEN turnout >= 50 AND total_electors <= 800 THEN 'Medium_Turnout_Small'
                    WHEN turnout < 50 AND total_electors > 800 THEN 'Low_Turnout_Large'
                    ELSE 'Low_Turnout_Small'
                END as cluster_type,
                COUNT(*) as booth_count,
                ROUND(AVG(total_electors)::numeric, 0) as avg_electors,
                ROUND(AVG(turnout)::numeric, 2) as avg_turnout
            FROM booth_features
            GROUP BY cluster_type
            ORDER BY booth_count DESC
        `, [acId, electionId]);

        const clusters = clustersQuery.rows;

        res.json({
            success: true,
            data: {
                clusters: clusters,
                total_clusters: clusters.length,
                total_booths: clusters.reduce((sum, c) => sum + c.booth_count, 0)
            }
        });

    } catch (error: any) {
        console.error('Error in booth clusters:', error);
        next(new AppError('Failed to fetch booth clusters', 500));
    }
});

// 4. FIXED: Booth Comparison
router.post('/compare', async (req, res, next) => {
    try {
        const { boothIds } = req.body;

        if (!boothIds || !Array.isArray(boothIds)) {
            return next(new AppError('Please provide booth IDs array', 400));
        }

        const comparisonQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                COALESCE(bt.male_voters, 0) as male_voters,
                COALESCE(bt.female_voters, 0) as female_voters,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as turnout_percentage,
                -- Get winning party
                (
                    SELECT p.party_name
                    FROM booth_results br
                    JOIN candidates c ON br.candidate_id = c.candidate_id
                    JOIN parties p ON c.party_id = p.party_id
                    WHERE br.booth_id = b.booth_id AND br.election_id = 1
                    ORDER BY br.votes_secured DESC
                    LIMIT 1
                ) as winning_party,
                -- Get winning votes
                (
                    SELECT MAX(br.votes_secured)
                    FROM booth_results br
                    WHERE br.booth_id = b.booth_id AND br.election_id = 1
                ) as winning_votes
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = 1
            WHERE b.booth_id = ANY($1)
            ORDER BY b.booth_number::integer
        `, [boothIds]);

        const comparison = comparisonQuery.rows;

        res.json({
            success: true,
            data: {
                booths: comparison,
                summary: {
                    total_booths: comparison.length,
                    avg_turnout: comparison.length > 0
                        ? comparison.reduce((sum, b) => sum + b.turnout_percentage, 0) / comparison.length
                        : 0,
                    total_electors: comparison.reduce((sum, b) => sum + b.total_electors, 0),
                    total_votes: comparison.reduce((sum, b) => sum + b.total_votes_cast, 0)
                }
            }
        });

    } catch (error: any) {
        console.error('Error in booth comparison:', error);
        next(new AppError('Failed to compare booths', 500));
    }
});

// 5. FIXED: Trends (Simplified)
router.get('/trends/:boothId', async (req, res, next) => {
    try {
        const { boothId } = req.params;

        const trendQuery = await pool.query(`
            SELECT 
                e.election_year,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as turnout_percentage
            FROM elections e
            LEFT JOIN booth_turnout bt ON bt.election_id = e.election_id AND bt.booth_id = $1
            WHERE e.election_id IN (1)  -- Only 2022 election for now
            ORDER BY e.election_year
        `, [boothId]);

        const trends = trendQuery.rows;

        res.json({
            success: true,
            data: {
                booth_id: boothId,
                trends: trends,
                message: trends.length > 1 ? 'Multiple election data available' : 'Single election data available'
            }
        });

    } catch (error: any) {
        console.error('Error in booth trends:', error);
        next(new AppError('Failed to fetch booth trends', 500));
    }
});

// 6. FIXED: Recommendations (Simplified)
router.get('/recommendations/:acId', async (req, res, next) => {
    try {
        const { acId } = req.params;
        const electionId = 1;

        const recommendationsQuery = await pool.query(`
            WITH booth_performance AS (
                SELECT 
                    b.booth_id,
                    b.booth_number,
                    b.booth_name,
                    COALESCE(bt.total_electors, 0) as total_electors,
                    COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                    CASE 
                        WHEN bt.total_electors > 0 
                        THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                        ELSE 0 
                    END as turnout,
                    -- Get winning party and votes
                    (
                        SELECT p.party_name
                        FROM booth_results br
                        JOIN candidates c ON br.candidate_id = c.candidate_id
                        JOIN parties p ON c.party_id = p.party_id
                        WHERE br.booth_id = b.booth_id AND br.election_id = $2
                        ORDER BY br.votes_secured DESC
                        LIMIT 1
                    ) as winning_party,
                    (
                        SELECT MAX(br.votes_secured)
                        FROM booth_results br
                        WHERE br.booth_id = b.booth_id AND br.election_id = $2
                    ) as winning_votes
                FROM booths b
                LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
                WHERE b.ac_id = $1
            ),
            booth_margins AS (
                SELECT 
                    bp.*,
                    -- Calculate margin (simplified)
                    CASE 
                        WHEN bp.total_votes_cast > 0 
                        THEN ROUND((bp.winning_votes * 100.0 / bp.total_votes_cast)::numeric, 2)
                        ELSE 0 
                    END as winning_percentage
                FROM booth_performance bp
            )
            SELECT 
                *,
                CASE 
                    WHEN winning_percentage < 55 THEN 'Highly_Competitive'
                    WHEN winning_percentage >= 55 THEN 'Stronghold'
                    WHEN turnout < 50 THEN 'Low_Turnout_Opportunity'
                    WHEN total_electors > 1000 THEN 'High_Density_Strategic'
                    ELSE 'Standard'
                END as recommendation_category
            FROM booth_margins
            ORDER BY 
                CASE 
                    WHEN winning_percentage < 55 THEN 1
                    WHEN turnout < 50 THEN 2
                    WHEN total_electors > 1000 THEN 3
                    ELSE 4
                END,
                booth_number::integer
        `, [acId, electionId]);

        const recommendations = recommendationsQuery.rows;

        res.json({
            success: true,
            data: {
                recommendations: recommendations,
                summary: {
                    total_booths: recommendations.length,
                    highly_competitive: recommendations.filter(r => r.recommendation_category === 'Highly_Competitive').length,
                    strongholds: recommendations.filter(r => r.recommendation_category === 'Stronghold').length,
                    low_turnout_opportunities: recommendations.filter(r => r.recommendation_category === 'Low_Turnout_Opportunity').length
                }
            }
        });

    } catch (error: any) {
        console.error('Error in recommendations:', error);
        next(new AppError('Failed to fetch recommendations', 500));
    }
});

// 7. FIXED: Demographic Analysis
router.get('/demographics/:acId', async (req, res, next) => {
    try {
        const { acId } = req.params;
        const electionId = 1;

        const demographicsQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.male_voters, 0) as male_voters,
                COALESCE(bt.female_voters, 0) as female_voters,
                COALESCE(bt.other_voters, 0) as other_voters,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.male_voters * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as male_percentage,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.female_voters * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as female_percentage,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as turnout_percentage
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
            WHERE b.ac_id = $1
            ORDER BY b.booth_number::integer
        `, [acId, electionId]);

        const demographics = demographicsQuery.rows;

        const insights = {
            total_electors: demographics.reduce((sum, d) => sum + d.total_electors, 0),
            male_electors: demographics.reduce((sum, d) => sum + d.male_voters, 0),
            female_electors: demographics.reduce((sum, d) => sum + d.female_voters, 0),
            avg_male_percentage: demographics.length > 0
                ? demographics.reduce((sum, d) => sum + d.male_percentage, 0) / demographics.length
                : 0,
            avg_female_percentage: demographics.length > 0
                ? demographics.reduce((sum, d) => sum + d.female_percentage, 0) / demographics.length
                : 0
        };

        res.json({
            success: true,
            data: {
                demographics: demographics,
                insights: insights
            }
        });

    } catch (error: any) {
        console.error('Error in demographics:', error);
        next(new AppError('Failed to fetch demographic analysis', 500));
    }
});

// 8. FIXED: Heatmap (Simplified - without location columns)
router.get('/heatmap/:acId', async (req, res, next) => {
    try {
        const { acId } = req.params;
        const { metric = 'turnout' } = req.query;
        const electionId = 1;

        const heatmapQuery = await pool.query(`
            SELECT 
                b.booth_id,
                b.booth_number,
                b.booth_name,
                -- Use 0 as default coordinates since location columns don't exist
                0 as location_lat,
                0 as location_long,
                COALESCE(bt.total_electors, 0) as total_electors,
                COALESCE(bt.total_votes_cast, 0) as total_votes_cast,
                CASE 
                    WHEN bt.total_electors > 0 
                    THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                    ELSE 0 
                END as turnout_percentage,
                -- Get winning party
                (
                    SELECT p.party_name
                    FROM booth_results br
                    JOIN candidates c ON br.candidate_id = c.candidate_id
                    JOIN parties p ON c.party_id = p.party_id
                    WHERE br.booth_id = b.booth_id AND br.election_id = $2
                    ORDER BY br.votes_secured DESC
                    LIMIT 1
                ) as winning_party,
                -- Calculate intensity based on metric
                CASE $3
                    WHEN 'turnout' THEN 
                        CASE 
                            WHEN bt.total_electors > 0 
                            THEN ROUND((bt.total_votes_cast * 100.0 / bt.total_electors)::numeric, 2)
                            ELSE 0 
                        END
                    WHEN 'voters' THEN COALESCE(bt.total_electors, 0)
                    ELSE COALESCE(bt.total_electors, 0)
                END as intensity
            FROM booths b
            LEFT JOIN booth_turnout bt ON b.booth_id = bt.booth_id AND bt.election_id = $2
            WHERE b.ac_id = $1
            ORDER BY b.booth_number::integer
        `, [acId, electionId, metric]);

        const heatmapData = heatmapQuery.rows;

        // Normalize intensity
        const intensities = heatmapData.map(h => h.intensity || 0);
        const maxIntensity = Math.max(...intensities);
        const minIntensity = Math.min(...intensities);

        const normalizedData = heatmapData.map(booth => ({
            ...booth,
            normalized_intensity: maxIntensity > minIntensity
                ? Math.round(((booth.intensity - minIntensity) / (maxIntensity - minIntensity)) * 100)
                : 50
        }));

        res.json({
            success: true,
            data: {
                heatmap: normalizedData,
                metadata: {
                    metric: metric,
                    total_points: normalizedData.length,
                    intensity_range: { min: minIntensity, max: maxIntensity }
                }
            }
        });

    } catch (error: any) {
        console.error('Error in heatmap:', error);
        next(new AppError('Failed to fetch heatmap data', 500));
    }
});

export default router;