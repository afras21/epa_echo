const connectDumpDB = require('../config/dumpDatabase');
let dumpConnection = null;

class FacilityController {
  /**
   * Get or create dump database connection
   */
  async getDumpConnection() {
    if (!dumpConnection || dumpConnection.readyState !== 1) {
      dumpConnection = await connectDumpDB();
    }
    return dumpConnection;
  }

  /**
   * Get Facility model from connection
   */
  async getFacilityModel() {
    const conn = await this.getDumpConnection();
    return conn.Facility;
  }

  /**
   * Build MongoDB query from filters
   */
  buildQuery(filters) {
    const query = {};

    if (filters.state) {
      query.State = { $regex: filters.state.toUpperCase(), $options: 'i' };
    }

    if (filters.city) {
      query.City = { $regex: filters.city, $options: 'i' };
    }

    if (filters.zip) {
      query.Zip = filters.zip;
    }

    if (filters.sic) {
      query.SIC = { $regex: filters.sic, $options: 'i' };
    }

    if (filters.naics) {
      query.NAICS = { $regex: filters.naics, $options: 'i' };
    }

    if (filters.frsId) {
      query.$or = [
        { REGISTRY_ID: { $regex: filters.frsId, $options: 'i' } },
        { FRS_ID: { $regex: filters.frsId, $options: 'i' } },
      ];
    }

    if (filters.name) {
      query.$or = [
        { FacilityName: { $regex: filters.name, $options: 'i' } },
        { 'facilityData.FacilityName': { $regex: filters.name, $options: 'i' } },
        { 'facilityData.facilityName': { $regex: filters.name, $options: 'i' } },
      ];
    }

    if (filters.type) {
      query['source.type'] = filters.type.toLowerCase();
    }

    return query;
  }

  /**
   * Generate nextToken for pagination
   */
  generateNextToken(lastFacility, skip) {
    if (!lastFacility) return null;
    
    // Create a token from the skip value for cursor-based pagination
    const tokenData = {
      skip: skip,
      timestamp: Date.now(),
    };
    
    const token = Buffer.from(JSON.stringify(tokenData)).toString('base64');
    return token;
  }

  /**
   * Decode nextToken
   */
  decodeNextToken(token) {
    if (!token) return null;
    
    try {
      const decoded = JSON.parse(Buffer.from(token, 'base64').toString());
      return decoded;
    } catch (error) {
      return null;
    }
  }

  /**
   * Get all facilities with filtering and pagination
   */
  async getAllFacilities(req, res) {
    try {
      const {
        state,
        city,
        zip,
        sic,
        naics,
        frsId,
        name,
        type, // 'cwa', 'air', 'rcra', etc.
        limit = 50,
        nextToken,
      } = req.query;

      // Build filters
      const filters = {};
      if (state) filters.state = state;
      if (city) filters.city = city;
      if (zip) filters.zip = zip;
      if (sic) filters.sic = sic;
      if (naics) filters.naics = naics;
      if (frsId) filters.frsId = frsId;
      if (name) filters.name = name;
      if (type) filters.type = type;

      const limitNum = Math.min(parseInt(limit) || 50, 500); // Max 500 per page

      // Get Facility model from dump database connection
      let Facility;
      try {
        Facility = await this.getFacilityModel();
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: `Failed to connect to dump database: ${error.message}. Please ensure MONGODB_DUMP_URI is set in your .env file.`,
        });
      }

      if (!Facility) {
        return res.status(500).json({
          success: false,
          error: 'Facility model not available. Please check your database connection.',
        });
      }

      // Build MongoDB query
      const query = this.buildQuery(filters);

      // Handle pagination with nextToken
      let skip = 0;
      if (nextToken) {
        const tokenData = this.decodeNextToken(nextToken);
        if (tokenData && tokenData.skip) {
          skip = parseInt(tokenData.skip) || 0;
        }
      }

      // Fetch facilities from MongoDB
      const facilities = await Facility.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum + 1) // Fetch one extra to check if there's more
        .lean();

      // Check if there are more results
      const hasMore = facilities.length > limitNum;
      const paginatedFacilities = hasMore ? facilities.slice(0, limitNum) : facilities;

      // Get total count (only if no filters or for first page)
      let total = null;
      if (skip === 0 && Object.keys(filters).length === 0) {
        total = await Facility.countDocuments(query);
      }

      // Generate next token
      const nextTokenValue = hasMore
        ? this.generateNextToken(
            paginatedFacilities[paginatedFacilities.length - 1],
            skip + limitNum
          )
        : null;

      res.json({
        success: true,
        data: paginatedFacilities,
        pagination: {
          limit: limitNum,
          count: paginatedFacilities.length,
          total: total,
          hasMore: hasMore,
          nextToken: nextTokenValue,
        },
        filters: Object.keys(filters).length > 0 ? filters : null,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Remove null/undefined values from object
   */
  removeNullValues(obj) {
    if (obj === null || obj === undefined) {
      return undefined;
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.removeNullValues(item)).filter(item => item !== undefined);
    }
    
    if (typeof obj === 'object') {
      const cleaned = {};
      for (const [key, value] of Object.entries(obj)) {
        const cleanedValue = this.removeNullValues(value);
        if (cleanedValue !== undefined && cleanedValue !== null) {
          cleaned[key] = cleanedValue;
        }
      }
      return cleaned;
    }
    
    return obj;
  }

  /**
   * Insert facilities into database
   * - Removes null values before inserting
   * - Stops on storage error
   */
  async insertFacilities(req, res) {
    try {
      const { facilities } = req.body;

      if (!facilities || !Array.isArray(facilities)) {
        return res.status(400).json({
          success: false,
          error: 'facilities must be an array',
        });
      }

      // Get Facility model
      let Facility;
      try {
        Facility = await this.getFacilityModel();
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: `Failed to connect to dump database: ${error.message}`,
        });
      }

      if (!Facility) {
        return res.status(500).json({
          success: false,
          error: 'Facility model not available',
        });
      }

      const cleanedFacilities = [];
      let insertedCount = 0;
      let errorCount = 0;
      let lastError = null;

      // Process and clean facilities
      for (let i = 0; i < facilities.length; i++) {
        try {
          const facility = facilities[i];
          
          // Remove null values
          const cleanedFacility = this.removeNullValues(facility);
          
          if (!cleanedFacility || Object.keys(cleanedFacility).length === 0) {
            console.log(`[SKIP] Facility ${i + 1}: Empty after removing null values`);
            errorCount++;
            continue;
          }

          cleanedFacilities.push(cleanedFacility);
        } catch (error) {
          console.error(`[ERROR] Error cleaning facility ${i + 1}:`, error.message);
          errorCount++;
          lastError = error;
          // Continue processing other facilities
        }
      }

      // Insert facilities in batches
      if (cleanedFacilities.length > 0) {
        try {
          const batchSize = 100;
          for (let i = 0; i < cleanedFacilities.length; i += batchSize) {
            const batch = cleanedFacilities.slice(i, i + batchSize);
            
            try {
              const result = await Facility.insertMany(batch, {
                ordered: false, // Continue on error but we'll catch it
                rawResult: true,
              });
              
              insertedCount += result.insertedCount || batch.length;
              console.log(`[INSERT] Batch ${Math.floor(i / batchSize) + 1}: Inserted ${result.insertedCount || batch.length} facilities`);
            } catch (batchError) {
              // Check if it's a storage/connection error
              if (batchError.name === 'MongoServerError' || 
                  batchError.message.includes('connection') ||
                  batchError.message.includes('timeout') ||
                  batchError.message.includes('network')) {
                // Storage error - stop inserting
                console.error(`[STORAGE ERROR] Stopping insertion at batch ${Math.floor(i / batchSize) + 1}:`, batchError.message);
                lastError = batchError;
                break; // Stop inserting
              } else {
                // Other errors (like duplicates) - continue
                const inserted = batchError.insertedDocs?.length || 0;
                insertedCount += inserted;
                errorCount += (batch.length - inserted);
                console.warn(`[WARNING] Batch ${Math.floor(i / batchSize) + 1}: ${inserted} inserted, ${batch.length - inserted} failed`);
              }
            }
          }
        } catch (storageError) {
          // Critical storage error - stop everything
          console.error('[CRITICAL STORAGE ERROR] Stopping all insertions:', storageError.message);
          return res.status(500).json({
            success: false,
            error: 'Storage error occurred. Insertion stopped.',
            details: storageError.message,
            stats: {
              inserted: insertedCount,
              failed: errorCount + (cleanedFacilities.length - insertedCount),
              total: facilities.length,
            },
          });
        }
      }

      res.json({
        success: true,
        message: 'Facilities insertion completed',
        stats: {
          total: facilities.length,
          inserted: insertedCount,
          failed: errorCount + (cleanedFacilities.length - insertedCount),
          skipped: facilities.length - cleanedFacilities.length,
        },
        error: lastError ? 'Some facilities failed to insert. Check logs for details.' : null,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get facility by ID (FRS ID or other identifier)
   */
  async getFacilityById(req, res) {
    try {
      const { id } = req.params;
      console.log(`[DEBUG] Searching for facility with ID: ${id}`);

      // Get Facility model from dump database connection
      let Facility;
      try {
        Facility = await this.getFacilityModel();
      } catch (error) {
        console.error(`[ERROR] Database connection failed:`, error.message);
        return res.status(500).json({
          success: false,
          error: `Failed to connect to dump database: ${error.message}. Please ensure MONGODB_DUMP_URI is set in your .env file.`,
        });
      }

      if (!Facility) {
        return res.status(500).json({
          success: false,
          error: 'Facility model not available. Please check your database connection.',
        });
      }

      // Trim whitespace from ID
      const cleanId = id.trim();
      console.log(`[DEBUG] Searching for facility with ID: "${cleanId}" (original: "${id}")`);

      // Try multiple search strategies with various field names and formats
      const searchQueries = [
        // REGISTRY_ID variations
        { REGISTRY_ID: cleanId },
        { REGISTRY_ID: cleanId.toString() },
        { 'REGISTRY_ID': cleanId }, // With quotes
        { 'registry_id': cleanId }, // Lowercase
        { 'Registry_ID': cleanId }, // Mixed case
        
        // FRS_ID variations
        { FRS_ID: cleanId },
        { FRS_ID: cleanId.toString() },
        { 'FRS_ID': cleanId },
        { 'frs_id': cleanId },
        
        // FacilityName partial match
        { FacilityName: { $regex: cleanId, $options: 'i' } },
      ];

      // If ID is numeric, also try as number
      if (!isNaN(cleanId)) {
        const numId = parseInt(cleanId);
        searchQueries.push(
          { REGISTRY_ID: numId },
          { REGISTRY_ID: numId.toString() },
          { FRS_ID: numId },
          { FRS_ID: numId.toString() },
          { 'REGISTRY_ID': numId },
          { 'registry_id': numId },
          { 'FRS_ID': numId },
          { 'frs_id': numId }
        );
      }

      console.log(`[DEBUG] Trying ${searchQueries.length} search queries`);

      // First, let's check what fields actually exist in the database
      const sampleFacility = await Facility.findOne({}).lean();
      if (sampleFacility) {
        console.log(`[DEBUG] Sample facility fields:`, Object.keys(sampleFacility));
        console.log(`[DEBUG] Sample facility ID fields:`, {
          REGISTRY_ID: sampleFacility.REGISTRY_ID,
          'registry_id': sampleFacility.registry_id,
          FRS_ID: sampleFacility.FRS_ID,
          'frs_id': sampleFacility.frs_id,
          _id: sampleFacility._id
        });
      }

      // Direct check: Try to find the exact ID in any possible field
      console.log(`[DEBUG] Direct search for ID: ${cleanId}`);
      
      // Try all possible field name variations
      const directSearchQueries = [
        { REGISTRY_ID: cleanId },
        { REGISTRY_ID: parseInt(cleanId) },
        { 'registry_id': cleanId },
        { 'registry_id': parseInt(cleanId) },
        { 'Registry_ID': cleanId },
        { 'Registry_ID': parseInt(cleanId) },
        { FRS_ID: cleanId },
        { FRS_ID: parseInt(cleanId) },
        { 'frs_id': cleanId },
        { 'frs_id': parseInt(cleanId) },
        { 'FRS_ID': cleanId },
        { 'FRS_ID': parseInt(cleanId) },
      ];
      
      const directSearch = await Facility.findOne({
        $or: directSearchQueries
      }).lean();
      
      if (directSearch) {
        console.log(`[DEBUG] ✓ Found facility with direct search!`);
        console.log(`[DEBUG] Facility data:`, {
          REGISTRY_ID: directSearch.REGISTRY_ID,
          'registry_id': directSearch.registry_id,
          FRS_ID: directSearch.FRS_ID,
          'frs_id': directSearch.frs_id,
          FacilityName: directSearch.FacilityName
        });
        return res.json({
          success: true,
          data: directSearch,
        });
      }

      // If not found, try a broader search - check if ID exists anywhere in the document
      console.log(`[DEBUG] Trying broader search - checking all fields...`);
      const allFacilities = await Facility.find({}).limit(100).lean();
      const matchingFacility = allFacilities.find(f => {
        const values = Object.values(f).map(v => v?.toString());
        return values.some(val => val && val.includes(cleanId));
      });
      
      if (matchingFacility) {
        console.log(`[DEBUG] ✓ Found facility in broader search!`);
        console.log(`[DEBUG] All facility fields:`, Object.keys(matchingFacility));
        return res.json({
          success: true,
          data: matchingFacility,
        });
      }

      const facility = await Facility.findOne({
        $or: searchQueries,
      }).lean();

      if (facility) {
        console.log(`[DEBUG] Facility found: ${facility.REGISTRY_ID || facility.FRS_ID || 'N/A'} - ${facility.FacilityName || 'N/A'}`);
        return res.json({
          success: true,
          data: facility,
        });
      }

      // Check if any facilities exist at all
      const totalCount = await Facility.countDocuments({});
      console.log(`[DEBUG] Facility not found. Total facilities in database: ${totalCount}`);

      res.status(404).json({
        success: false,
        error: `Facility not found with ID: ${id}`,
        debug: {
          searchedId: id,
          totalFacilitiesInDB: totalCount,
          searchStrategies: ['FRS_ID (string)', 'FRS_ID (number)', 'FacilityName (partial)'],
        },
      });
    } catch (error) {
      console.error(`[ERROR] Error in getFacilityById:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new FacilityController();

