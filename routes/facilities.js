const express = require('express');
const router = express.Router();
const facilityController = require('../controllers/facilityController');

/**
 * POST /api/facilities
 * Insert facilities into database
 * - Removes null values before inserting (e.g., RCRA_PERMIT_TYPES: null will be removed)
 * - Stops on storage error
 * 
 * Body: {
 *   "facilities": [
 *     { "FRS_ID": "...", "FacilityName": "...", ... },
 *     ...
 *   ]
 * }
 */
router.post('/', (req, res) => facilityController.insertFacilities(req, res));

/**
 * GET /api/facilities
 * Get all facilities with filtering and pagination
 * 
 * Query Parameters:
 * - state: Filter by state (e.g., CA, NY, TX)
 * - city: Filter by city name
 * - zip: Filter by ZIP code
 * - sic: Filter by SIC code
 * - naics: Filter by NAICS code
 * - frsId: Filter by FRS ID
 * - name: Filter by facility name (partial match)
 * - type: Filter by API type (cwa, air, rcra)
 * - limit: Number of results per page (default: 50, max: 500)
 * - nextToken: Token for pagination (from previous response)
 */
router.get('/', (req, res) => facilityController.getAllFacilities(req, res));

/**
 * GET /api/facilities/:id
 * Get a specific facility by ID (FRS ID or facility name)
 */
router.get('/:id', (req, res) => facilityController.getFacilityById(req, res));

module.exports = router;

