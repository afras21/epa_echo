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
      query.FRS_ID = { $regex: filters.frsId, $options: 'i' };
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
   * Get facility by ID (FRS ID or other identifier)
   */
  async getFacilityById(req, res) {
    try {
      const { id } = req.params;

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

      // Search by FRS_ID or FacilityName
      const facility = await Facility.findOne({
        $or: [
          { FRS_ID: id },
          { FacilityName: { $regex: id, $options: 'i' } },
        ],
      }).lean();

      if (facility) {
        return res.json({
          success: true,
          data: facility,
        });
      }

      res.status(404).json({
        success: false,
        error: 'Facility not found',
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
}

module.exports = new FacilityController();

