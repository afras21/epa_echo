const connectDumpDB = require('../config/dumpDatabase');
const { connectRedis, getRedisClient } = require('../config/redis');
const axios = require('axios');
let dumpConnection = null;

// EPA ECHO base URL
const EPA_ECHO_BASE_URL = 'https://echodata.epa.gov';

/**
 * Transform raw facility data into structured format
 */
function transformRawData(raw) {
  if (!raw) return null;

  // Helper: Convert empty strings/null to null
  const clean = (v) => (v === "" || v === undefined ? null : v);

  // Helper: Convert EPA date formats to YYYY-MM-DD
  const toDate = (d) => {
    if (!d || d === "") return null;
    // raw sometimes returns MM/DD/YYYY
    if (typeof d === 'string' && d.includes("/")) {
      const [m, day, y] = d.split("/");
      return `${y}-${m.padStart(2, "0")}-${day.padStart(2, "0")}`;
    }
    return d;
  };

  // Programs detected from flags
  const programs = [];
  if (raw.NPDES_FLAG === "Y") programs.push({ code: "NPDES", programDesc: "National Pollutant Discharge Elimination System" });
  if (raw.AIR_FLAG === "Y")   programs.push({ code: "CAA", programDesc: "Clean Air Act" });
  if (raw.RCRA_FLAG === "Y")  programs.push({ code: "RCRA", programDesc: "Resource Conservation & Recovery Act" });
  if (raw.TRI_FLAG === "Y")   programs.push({ code: "TRI", programDesc: "Toxic Release Inventory" });

  // --- Compliance Score Calculation (0–10) ---
  const scoreFromNC = (quarters) => {
    if (quarters == null) return 10;
    if (quarters === 0) return 10;
    if (quarters === 1) return 8;
    if (quarters === 2) return 6;
    if (quarters === 3) return 4;
    return 2;
  };

  const waterScore = scoreFromNC(Number(raw.CWA_QTRS_WITH_NC || 0));
  const airScore = raw.AIR_FLAG === "Y" ? scoreFromNC(Number(raw.CAA_QTRS_WITH_NC || 0)) : 10;
  const wasteScore = raw.RCRA_FLAG === "Y" ? scoreFromNC(Number(raw.RCRA_QTRS_WITH_NC || 0)) : 10;
  const overallScore = Math.round((waterScore + airScore + wasteScore) / 3);

  // Calculate days since last inspection
  const lastInspectionDate = toDate(raw.FAC_DATE_LAST_INSPECTION_EPA) || toDate(raw.FAC_DATE_LAST_INSPECTION_STATE);
  let daysSinceLastInspection = null;
  if (lastInspectionDate) {
    const inspectionDate = new Date(lastInspectionDate);
    const today = new Date();
    daysSinceLastInspection = Math.floor((today - inspectionDate) / (1000 * 60 * 60 * 24));
  }

  // Calculate days since last formal action
  const lastFormalActionDate = toDate(raw.FAC_DATE_LAST_FORMAL_ACT_EPA);
  let daysSinceLastFormalAction = null;
  if (lastFormalActionDate) {
    const actionDate = new Date(lastFormalActionDate);
    const today = new Date();
    daysSinceLastFormalAction = Math.floor((today - actionDate) / (1000 * 60 * 60 * 24));
  }

  // Count programs with SNC
  let programsWithSNC = 0;
  if (raw.CWA_SNC_FLG === "Y") programsWithSNC++;
  if (raw.CAA_SNC_FLG === "Y") programsWithSNC++;
  if (raw.RCRA_SNC_FLG === "Y") programsWithSNC++;

  // Build permits array
  const permits = [];
  if (raw.NPDES_IDS) {
    permits.push({
      type: "NPDES Permit",
      number: String(raw.NPDES_IDS),
      issueDate: null,
      expiryDate: null,
      expirationDate: null,
      status: raw.CWA_COMPLIANCE_STATUS || "Unknown",
      program: "CWA",
      programDesc: "National Pollutant Discharge Elimination System",
      components: raw.CWA_PERMIT_TYPES ? [{ componentType: String(raw.CWA_PERMIT_TYPES), description: String(raw.CWA_PERMIT_TYPES) }] : [],
      featureCoordinates: (raw.FAC_LAT && raw.FAC_LONG) ? [{
        latitude: Number(raw.FAC_LAT),
        longitude: Number(raw.FAC_LONG),
        featureNumber: "001"
      }] : []
    });
  }
  if (raw.AIR_IDS) {
    permits.push({
      type: "Air Permit",
      number: String(raw.AIR_IDS),
      issueDate: null,
      expiryDate: null,
      expirationDate: null,
      status: "Active",
      program: "CAA",
      programDesc: "Clean Air Act"
    });
  }
  if (raw.RCRA_IDS) {
    permits.push({
      type: "RCRA Permit",
      number: String(raw.RCRA_IDS),
      issueDate: null,
      expiryDate: null,
      expirationDate: null,
      status: "Active",
      program: "RCRA",
      programDesc: "Resource Conservation & Recovery Act"
    });
  }

  // --- Build the Output Object ---
  return {
    _id: raw.REGISTRY_ID,
    REGISTRY_ID: raw.REGISTRY_ID,
    facility: {
      id: raw.REGISTRY_ID,
      registryId: raw.REGISTRY_ID,
      epaId: raw.REGISTRY_ID,
      name: clean(raw.FAC_NAME),
      facilityName: clean(raw.FAC_NAME),
      address: clean(raw.FAC_STREET),
      street: clean(raw.FAC_STREET),
      city: clean(raw.FAC_CITY),
      state: clean(raw.FAC_STATE),
      zip: clean(raw.FAC_ZIP),
      county: clean(raw.FAC_COUNTY),
      latitude: Number(raw.FAC_LAT) || 0,
      longitude: Number(raw.FAC_LONG) || 0,
      industry: clean(raw.SIC_DESCRIPTION) || "",
      sicCode: clean(raw.FAC_SIC_CODES),
      naicsCode: clean(raw.FAC_NAICS_CODES),
      established: "",
      employees: "",
      phone: "",
      email: "",
      riskScore: 0,
      programs,
      complianceStatus: clean(raw.FAC_COMPLIANCE_STATUS) || "Unknown",
      lastInspection: lastInspectionDate,
      lastInspectionType: raw.FAC_DATE_LAST_INSPECTION_EPA ? "EPA" :
                          raw.FAC_DATE_LAST_INSPECTION_STATE ? "State" :
                          "Unknown",
      inspectionDates: {
        epa: toDate(raw.FAC_DATE_LAST_INSPECTION_EPA),
        state: toDate(raw.FAC_DATE_LAST_INSPECTION_STATE),
        mostRecent: {
          date: lastInspectionDate,
          type: raw.FAC_DATE_LAST_INSPECTION_EPA ? "EPA" :
                raw.FAC_DATE_LAST_INSPECTION_STATE ? "State" :
                "Unknown"
        }
      },
      enforcementActions: {
        lastFormalActionEPA: toDate(raw.FAC_DATE_LAST_FORMAL_ACT_EPA),
        lastFormalActionState: toDate(raw.FAC_DATE_LAST_FORMAL_ACT_STATE),
        lastInformalActionEPA: toDate(raw.FAC_DATE_LAST_INFORMAL_ACT_EPA),
        lastInformalActionState: toDate(raw.FAC_DATE_LAST_INFORMAL_ACT_STATE)
      },
      permits,
      aggregatedData: {
        totalPenalties: Number(raw.FAC_TOTAL_PENALTIES || 0),
        formalActionCount: Number(raw.FAC_FORMAL_ACTION_COUNT || 0),
        informalCount: Number(raw.FAC_INFORMAL_COUNT || 0),
        inspectionCount: Number(raw.FAC_INSPECTION_COUNT || 0),
        quartersWithNC: Number(raw.FAC_QTRS_WITH_NC || 0),
        programsWithSNC: programsWithSNC,
        daysSinceLastInspection: daysSinceLastInspection,
        daysSinceLastFormalAction: daysSinceLastFormalAction
      },
      iconBaseURL: "https://echo.epa.gov/themes/custom/echo/images/map/",
      mapIcon: raw.FAC_MAP_ICON || raw.mapIcon || "",
      mapIconURL: raw.mapIconURL || (raw.FAC_MAP_ICON ? `https://echo.epa.gov/themes/custom/echo/images/map/${raw.FAC_MAP_ICON}` : "")
    },
    violations: [], // Will fill separately from CWA/CAA/RCRA endpoints
    inspections: [],
    complianceScores: {
      overall: overallScore,
      air: airScore,
      water: waterScore,
      waste: wasteScore
    },
    enforcementActions: [],
    emissions: [],
    stackTests: [],
    titleVCerts: [],
    pollutants: [],
    dataGroups: [],
    qncrHistory: [],
    rawData: raw
  };
}

class FacilityController {
  /**
   * Initialize Redis connection
   */
  async initRedis() {
    const client = getRedisClient();
    if (!client || !client.isOpen) {
      await connectRedis();
      return getRedisClient();
    }
    return client;
  }

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
   * Get native MongoDB collections for related data
   * (facilities, violations, inspections, emissions, enforcements, enforcementSummary)
   * We use the underlying connection.db to support the new separated collections design.
   */
  async getCollections() {
    const conn = await this.getDumpConnection();
    const db = conn.db;

    return {
      facilities: db.collection('facilities'),
      violations: db.collection('violations'),
      inspections: db.collection('inspections'),
      emissions: db.collection('emissions'),
      enforcements: db.collection('enforcements'),
      enforcementSummary: db.collection('enforcementSummary'),
    };
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

      const limitNum = Math.min(parseInt(limit) || 25, 500); // Default 25, max 500 per page

      // Get Facility model from dump database connection (facilities summary collection)
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

      // Build MongoDB query for facilities collection (summary documents)
      const query = this.buildQuery(filters);

      // Handle pagination with nextToken
      let skip = 0;
      if (nextToken) {
        const tokenData = this.decodeNextToken(nextToken);
        if (tokenData && tokenData.skip) {
          skip = parseInt(tokenData.skip) || 0;
        }
      }

      // Fetch facilities from MongoDB facilities collection
      const facilities = await Facility.find(query)
        .sort({ updatedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limitNum + 1) // Fetch one extra to check if there's more
        .lean();
      
      console.log(`[DEBUG] getAllFacilities - Found ${facilities.length} facilities from facilities collection`);

      // Transform facilities to return only requested fields for list view
      const transformedFacilities = facilities.map(doc => {
        // Support both the new flattened summary shape and older raw shapes
        const cleanFacility = {
          name: doc.name || doc.facilityName || doc.FacilityName || doc.FAC_NAME || '',
          address: doc.address || doc.street || doc.FAC_STREET || '',
          street: doc.street || doc.FAC_STREET || '',
          city: doc.city || doc.City || doc.FAC_CITY || '',
          state: doc.state || doc.State || doc.FAC_STATE || '',
          zip: doc.zip || doc.Zip || doc.FAC_ZIP || '',
          county: doc.county || doc.County || doc.FAC_COUNTY || '',
          region: doc.region || doc.Region || '',
          industryGroup: doc.industryGroup || doc.industry || doc.industry_group || '',
          latitude: doc.latitude || doc.Latitude || doc.FAC_LAT || null,
          longitude: doc.longitude || doc.Longitude || doc.FAC_LONG || null,
          programs: doc.programs || [],
          complianceStatus: doc.complianceStatus || doc.fac_compliance_status || '',
          riskScore: doc.riskScore || (doc.complianceScores && doc.complianceScores.overall) || null,
          lastInspection: doc.lastInspection ||
            (doc.inspectionDates && doc.inspectionDates.mostRecent && doc.inspectionDates.mostRecent.date) ||
            (doc.inspectionDates && doc.inspectionDates.epa) ||
            (doc.inspectionDates && doc.inspectionDates.state) ||
            null,
          violationCount: doc.violationCount || 0,
        };

        // Return only requested fields for list view
        return {
          _id: doc._id || doc.REGISTRY_ID || null,
          name: cleanFacility.name || '',
          address: cleanFacility.address || cleanFacility.street || '',
          street: cleanFacility.street || '',
          city: cleanFacility.city || '',
          state: cleanFacility.state || '',
          zip: cleanFacility.zip || '',
          county: cleanFacility.county || '',
          region: cleanFacility.region || '',
          industryGroup: cleanFacility.industryGroup || '',
          lat: cleanFacility.latitude || null,
          long: cleanFacility.longitude || null,
          programs: cleanFacility.programs || [],
          complianceStatus: cleanFacility.complianceStatus || '',
          riskScoreOverall: cleanFacility.riskScore,
          violationsCount: cleanFacility.violationCount,
          lastInspectionDate: cleanFacility.lastInspection,
        };
      });

      // Check if there are more results
      const hasMore = transformedFacilities.length > limitNum;
      const paginatedFacilities = hasMore ? transformedFacilities.slice(0, limitNum) : transformedFacilities;

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
   * Calculate statistics from database (internal method)
   */
  async calculateStatistics() {
    try {
      // Get FacilityDetails model (has the nested facility structure)
      let FacilityDetails;
      try {
        FacilityDetails = await this.getFacilityDetailsModel();
      } catch (error) {
        throw new Error(`Failed to connect to dump database: ${error.message}`);
      }

      if (!FacilityDetails) {
        throw new Error('FacilityDetails model not available. Please check your database connection.');
      }

      console.log(`[STATS] Querying facilityDetails collection for statistics...`);

    // Get all facilities
    const allFacilities = await FacilityDetails.find({}).lean();
    const totalFacilities = allFacilities.length;

    console.log(`[STATS] Found ${totalFacilities} facilities`);

    // Initialize counters
    let compliant = 0;
    let nonCompliant = 0;
    let underReview = 0;
    let highRisk = 0;
    let activeViolations = 0;

    const programCounts = {
      air: 0,
      water: 0,
      waste: 0,
      enforcements: 0,
    };

    const highRiskFacilities = [];
    const latestInspections = [];
    const recentSearches = [];

    // Process each facility
    for (const doc of allFacilities) {
      const fac = doc.facility || {};
      const violations = doc.violations || [];
      const enforcementCases = doc.enforcementCases || [];
      const inspections = doc.inspections || [];
      const complianceScores = doc.complianceScores || {};
      const riskScore = fac.riskScore || 10.0;

      // Compliance status
      const complianceStatus = (fac.complianceStatus || '').trim();
      if (!complianceStatus || complianceStatus.includes('No Violation') || complianceStatus === '') {
        compliant++;
      } else if (complianceStatus.includes('Violation') || complianceStatus.includes('SNC')) {
        nonCompliant++;
      } else {
        underReview++;
      }

      // High risk (risk score < 5.0 or has violations)
      const realViolations = violations.filter(v => {
        const violationType = v.violationType || '';
        return violationType !== 'No Violation Identified' && violationType !== '';
      });

      if (riskScore < 5.0 || realViolations.length > 0) {
        highRisk++;
        highRiskFacilities.push({
          registryId: fac.registryId || fac.id || '',
          name: fac.name || 'Unknown Facility',
          city: fac.city || '',
          state: fac.state || '',
          riskScore: riskScore,
          violations: realViolations.length,
          complianceStatus: complianceStatus,
        });
      }

      // Active violations
      const activeViols = violations.filter(v => {
        const violationType = v.violationType || '';
        return violationType !== 'No Violation Identified' && 
               violationType !== '' && 
               !v.resolved;
      });
      activeViolations += activeViols.length;

      // Program counts
      const programs = fac.programs || [];
      for (const prog of programs) {
        const code = typeof prog === 'object' ? prog.code : prog;
        if (code === 'CAA') {
          programCounts.air++;
        } else if (code === 'NPDES' || code === 'CWA') {
          programCounts.water++;
        } else if (code === 'RCRA') {
          programCounts.waste++;
        }
      }

      if (enforcementCases.length > 0) {
        programCounts.enforcements++;
      }

      // Latest inspections (from inspections array)
      for (const insp of inspections) {
        const inspDate = insp.date || '';
        if (inspDate && inspDate.trim()) {
          latestInspections.push({
            registryId: fac.registryId || fac.id || '',
            name: fac.name || 'Unknown Facility',
            city: fac.city || '',
            state: fac.state || '',
            inspectionDate: inspDate,
            type: insp.type || '',
            program: insp.program || '',
          });
        }
      }

      // Also check facility's lastInspection field
      const lastInsp = fac.lastInspection || '';
      if (lastInsp && lastInsp.trim()) {
        latestInspections.push({
          registryId: fac.registryId || fac.id || '',
          name: fac.name || 'Unknown Facility',
          city: fac.city || '',
          state: fac.state || '',
          inspectionDate: lastInsp,
          type: fac.lastInspectionType || '',
          program: 'General',
        });
      }

      // Check inspectionDates object
      const inspectionDates = fac.inspectionDates || {};
      if (inspectionDates && typeof inspectionDates === 'object') {
        for (const [key, value] of Object.entries(inspectionDates)) {
          if (key !== 'mostRecent' && value && typeof value === 'string' && value.trim()) {
            latestInspections.push({
              registryId: fac.registryId || fac.id || '',
              name: fac.name || 'Unknown Facility',
              city: fac.city || '',
              state: fac.state || '',
              inspectionDate: value,
              type: key.toUpperCase(),
              program: 'General',
            });
          }
        }

        // Check mostRecent
        const mostRecent = inspectionDates.mostRecent;
        if (mostRecent && typeof mostRecent === 'object') {
          const mrDate = mostRecent.date || '';
          if (mrDate && mrDate.trim()) {
            latestInspections.push({
              registryId: fac.registryId || fac.id || '',
              name: fac.name || 'Unknown Facility',
              city: fac.city || '',
              state: fac.state || '',
              inspectionDate: mrDate,
              type: mostRecent.type || '',
              program: 'General',
            });
          }
        }
      }
    }

    // Sort high risk facilities by risk score (lowest first = highest risk)
    highRiskFacilities.sort((a, b) => (a.riskScore || 10.0) - (b.riskScore || 10.0));

    // Deduplicate inspections (same registryId + inspectionDate)
    const seenInspections = new Set();
    const uniqueInspections = [];
    for (const insp of latestInspections) {
      const key = `${insp.registryId || ''}_${insp.inspectionDate || ''}`;
      if (!seenInspections.has(key)) {
        seenInspections.add(key);
        uniqueInspections.push(insp);
      }
    }

    // Sort inspections by date (most recent first)
    const parseInspectionDate = (dateStr) => {
      if (!dateStr) return new Date(0);
      try {
        // Try different date formats
        if (dateStr.includes('/')) {
          const [m, d, y] = dateStr.split('/');
          return new Date(`${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`);
        } else if (dateStr.includes('-')) {
          return new Date(dateStr);
        }
        return new Date(dateStr);
      } catch (e) {
        return new Date(0);
      }
    };

    uniqueInspections.sort((a, b) => {
      const dateA = parseInspectionDate(a.inspectionDate);
      const dateB = parseInspectionDate(b.inspectionDate);
      return dateB - dateA; // Most recent first
    });

    // Get top 10 high risk facilities (remove internal fields)
    const topHighRisk = highRiskFacilities.slice(0, 10).map(fac => ({
      registryId: fac.registryId,
      name: fac.name,
      city: fac.city,
      state: fac.state,
    }));

    // Get top 10 latest inspections
    const topInspections = uniqueInspections.slice(0, 10);

    // Generate recent searches (use facilities with most data as "recent searches")
    const facilitiesByScore = [...allFacilities].sort((a, b) => {
      const scoreA = (a.violations?.length || 0) + (a.enforcementCases?.length || 0) + (a.inspections?.length || 0);
      const scoreB = (b.violations?.length || 0) + (b.enforcementCases?.length || 0) + (b.inspections?.length || 0);
      return scoreB - scoreA;
    });

    for (const doc of facilitiesByScore.slice(0, 3)) {
      const fac = doc.facility || {};
      recentSearches.push({
        registryId: fac.registryId || fac.id || '',
        name: fac.name || 'Unknown Facility',
        city: fac.city || '',
        state: fac.state || '',
        lastAccessed: new Date().toISOString(),
      });
    }

    // Build statistics JSON
    const statistics = {
      success: true,
      updatedAt: new Date().toISOString(),
      statistics: {
        totalFacilities: totalFacilities,
        compliant: compliant,
        nonCompliant: nonCompliant,
        underReview: underReview,
        highRisk: highRisk,
        activeViolations: activeViolations,
        programs: programCounts,
        topRecentSearches: recentSearches,
        topHighRiskFacilities: topHighRisk,
        latestInspections: topInspections,
      },
    };

    console.log(`[STATS] Statistics generated successfully`);
    console.log(`[STATS] Total: ${totalFacilities}, Compliant: ${compliant}, Non-Compliant: ${nonCompliant}, High Risk: ${highRisk}`);

    return statistics;
    } catch (error) {
      console.error(`[ERROR] Error in calculateStatistics:`, error);
      throw error;
    }
  }

  /**
   * Get facility statistics and analytics
   * Returns: default statistics data (always returns getDefaultStatistics)
   */
  async getFacilityStatistics(req, res) {
    try {
      // Always return default statistics
      const defaultStats = this.getDefaultStatistics();
      console.log(`[STATS] Returning default statistics`);
      res.json(defaultStats);
    } catch (error) {
      console.error(`[ERROR] Error in getFacilityStatistics:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Get default/initial statistics structure
   * Used when Redis is empty or as fallback
   */
  getDefaultStatistics() {
    return {
      success: true,
      updatedAt: new Date().toISOString(),
      statistics: {
        totalFacilities: 3021242,
        compliant: 2641153,
        nonCompliant: 78640,
        underReview: 301449,
        highRisk: 2172653,
        activeViolations: 2172653,
        programs: {
          air: 265541,
          water: 953032,
          waste: 1438783,
          enforcements: 43250,
        },
        topRecentSearches: [
          {
            registryId: "110005522728",
            name: "WAUKESHA WATER UTILITY",
            city: "WAUKESHA",
            state: "WI",
            lastAccessed: new Date().toISOString(),
          },
          {
            registryId: "110010758439",
            name: "RIDGEDALE HOA",
            city: "CANDLER",
            state: "NC",
            lastAccessed: new Date().toISOString(),
          },
          {
            registryId: "110000481611",
            name: "KERN ENERGY",
            city: "BAKERSFIELD",
            state: "CA",
            lastAccessed: new Date().toISOString(),
          },
        ],
        topHighRiskFacilities: [
          {
            registryId: "110066857985",
            name: "CLCM ST FRANCIS",
            city: "SAINT FRANCIS",
            state: "WI",
          },
          {
            registryId: "110031443347",
            name: "TFORCE FREIGHT FORT WORTH",
            city: "FORT WORTH",
            state: "TX",
          },
          {
            registryId: "110017613439",
            name: "UPS EL PASO GATEWAY",
            city: "EL PASO",
            state: "TX",
          },
          {
            registryId: "110009058802",
            name: "POGO MINE",
            city: "DELTA JUNCTION",
            state: "AK",
          },
          {
            registryId: "110070669710",
            name: "UPS SAVANNAH HUB",
            city: "SAVANNAH",
            state: "GA",
          },
          {
            registryId: "110031311104",
            name: "TFORCE FREIGHT LAREDO TX",
            city: "LAREDO",
            state: "TX",
          },
          {
            registryId: "110000603749",
            name: "BEFESA ZINC US INC",
            city: "PALMERTON",
            state: "PA",
          },
          {
            registryId: "110000464006",
            name: "VALERO PORT ARTHUR REFINERY",
            city: "PORT ARTHUR",
            state: "TX",
          },
          {
            registryId: "110007285669",
            name: "GIVENS COAL CO",
            city: "MIDDLESBORO",
            state: "KY",
          },
          {
            registryId: "110064097677",
            name: "MEADOWLARK MIDSTREAM COMPANY, LLC",
            city: "ATHENS TOWNSHIP",
            state: "ND",
          },
        ],
        latestInspections: [
          {
            registryId: "110001675214",
            name: "JOHNS MANVILLE SPARTANBURG PLANT",
            city: "SPARTANBURG",
            state: "SC",
            inspectionDate: "11/14/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110071782192",
            name: "HOCKINSON RESERVOIR 2",
            city: "BRUSH PRAIRIE",
            state: "WA",
            inspectionDate: "11/13/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110006653834",
            name: "UPS FREIGHT",
            city: "PADUCAH",
            state: "KY",
            inspectionDate: "11/13/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110024997244",
            name: "FLETCHER OIL CO. INC. - HOB NOB STORE",
            city: "RUSSELLVILLE",
            state: "AR",
            inspectionDate: "11/13/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110071823096",
            name: "GOLDEN (JACOBY) MEADOWS SENIOR APARTMENTS - DW",
            city: "WINDSOR",
            state: "CO",
            inspectionDate: "11/13/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110071447601",
            name: "WF WEST BASEBALL FIELD",
            city: "CHEHALIS",
            state: "WA",
            inspectionDate: "11/12/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110000588409",
            name: "PILGRIM'S PRIDE CORPORATION (FEED MILL)",
            city: "AMBROSE",
            state: "GA",
            inspectionDate: "11/12/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110000383870",
            name: "JOHNS MANVILLE INTERNATIONAL INC",
            city: "WATERVILLE",
            state: "OH",
            inspectionDate: "11/12/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110009975358",
            name: "WAYNETOWN MUNICIPAL WWTP",
            city: "WAYNETOWN",
            state: "IN",
            inspectionDate: "11/12/2025",
            type: "State",
            program: "General",
          },
          {
            registryId: "110071359400",
            name: "MARTIN WAY PHASE 2",
            city: "OLYMPIA",
            state: "WA",
            inspectionDate: "11/12/2025",
            type: "State",
            program: "General",
          },
        ],
      },
    };
  }

  /**
   * Get enforcement analytics report from precomputed summary data.
   * Reads directly from the enforcementSummary collection and returns documents as-is,
   * optionally filtered by year.
   */
  async getEnforcementReport(req, res) {
    try {
      const { year } = req.query;

      // Get native collections
      const collections = await this.getCollections();
      const summaryCol = collections.enforcementSummary;

      if (!summaryCol) {
        return res.status(500).json({
          success: false,
          error: 'enforcementSummary collection not available in database.',
        });
      }

      // Build optional year filter; support numeric or string year in DB
      const filter = {};
      if (year) {
        const yearNum = parseInt(year, 10);
        if (!Number.isNaN(yearNum)) {
          filter.$or = [
            { year: yearNum },
            { year: year.toString() },
          ];
        } else {
          filter.year = year.toString();
        }
      }

      const docs = await summaryCol
        .find(filter)
        .sort({ year: -1 })
        .toArray();

      return res.json({
        success: true,
        updatedAt: new Date().toISOString(),
        data: docs,
      });
    } catch (error) {
      console.error('[ERROR] Error in getEnforcementReport:', error);
      return res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Initialize Redis with statistics data
   * Called on server startup to populate cache
   */
  async initializeStatisticsInRedis() {
    try {
      console.log(`[STATS INIT] Initializing statistics in Redis...`);
      
      // Initialize Redis if needed
      const redisClient = await this.initRedis();

      if (!redisClient || !redisClient.isOpen) {
        console.warn(`[STATS INIT] Redis not available, skipping initialization`);
        return;
      }

      const cacheKey = 'facility:statistics';
      
      // Check if data already exists
      const existing = await redisClient.get(cacheKey);
      if (existing) {
        console.log(`[STATS INIT] Statistics already exist in Redis, skipping initialization`);
        return;
      }

      // Use default statistics if Redis is empty
      console.log(`[STATS INIT] Redis is empty, storing default statistics...`);
      const defaultStats = this.getDefaultStatistics();
      
      // Store in Redis cache (with 24 hour expiration)
      await redisClient.setEx(cacheKey, 86400, JSON.stringify(defaultStats)); // 24 hours
      console.log(`[STATS INIT] ✓ Default statistics stored in Redis`);
      console.log(`[STATS INIT]   Total Facilities: ${defaultStats.statistics.totalFacilities}`);
      console.log(`[STATS INIT]   Cache expires in 24 hours\n`);
    } catch (error) {
      console.error(`[STATS INIT] Error initializing statistics:`, error);
      // Don't throw - allow server to start even if Redis init fails
    }
  }

  /**
   * Daily job to update statistics in Redis
   * Runs every day at midnight
   */
  async updateStatisticsDaily() {
    try {
      console.log(`[STATS JOB] Starting daily statistics update...`);
      
      // Initialize Redis if needed
      const redisClient = await this.initRedis();

      // Calculate fresh statistics
      const statistics = await this.calculateStatistics();

      // Store in Redis cache (with 24 hour expiration)
      if (redisClient && redisClient.isOpen) {
        const cacheKey = 'facility:statistics';
        await redisClient.setEx(cacheKey, 86400, JSON.stringify(statistics)); // 24 hours
        console.log(`[STATS JOB] Statistics updated in Redis at ${new Date().toISOString()}`);
      } else {
        console.warn(`[STATS JOB] Redis not available, skipping cache update`);
      }
    } catch (error) {
      console.error(`[STATS JOB] Error updating statistics:`, error);
    }
  }

  /**
   * Helper function to get value from nested object with multiple key variations
   */
  getValue(obj, keys, defaultValue = null) {
    for (const key of keys) {
      if (obj && obj[key] !== undefined && obj[key] !== null) {
        return obj[key];
      }
    }
    return defaultValue;
  }

  /**
   * Derive program participation from flags
   */
  derivePrograms(facilityData) {
    const programs = [];
    const programFlags = {
      'AIR_FLAG': 'CAA',
      'NPDES_FLAG': 'NPDES',
      'SDWIS_FLAG': 'SDWIS',
      'RCRA_FLAG': 'RCRA',
      'TRI_FLAG': 'TRI',
      'GHG_FLAG': 'GHG',
    };

    Object.entries(programFlags).forEach(([flag, program]) => {
      const value = this.getValue(facilityData, [flag, flag.toLowerCase()]);
      if (value === 'Y' || value === 'Yes' || value === true) {
        programs.push(program);
      }
    });

    return programs;
  }

  /**
   * Parse compliance history string (e.g., "____________" or "VVSSRR____")
   * _ = no violation, V = violation, S = SNC, R = resolved
   */
  parseComplianceHistory(historyString) {
    if (!historyString || typeof historyString !== 'string') {
      return null;
    }

    const quarters = [];
    for (let i = 0; i < historyString.length; i++) {
      const char = historyString[i];
      const status = {
        '_': 'no_violation',
        'V': 'violation',
        'S': 'snc',
        'R': 'resolved',
      }[char] || 'unknown';

      quarters.push({
        quarter: i + 1,
        status: status,
        symbol: char,
      });
    }

    return {
      history: quarters,
      totalQuarters: quarters.length,
      violations: quarters.filter(q => q.status === 'violation' || q.status === 'snc').length,
      sncCount: quarters.filter(q => q.status === 'snc').length,
      resolvedCount: quarters.filter(q => q.status === 'resolved').length,
    };
  }

  /**
   * Get EPA region name from number
   */
  getEPARegionName(regionNumber) {
    const regions = {
      1: 'New England',
      2: 'Mid-Atlantic',
      3: 'Mid-Atlantic',
      4: 'Southeast',
      5: 'Midwest',
      6: 'South Central',
      7: 'Great Plains',
      8: 'Mountains & Plains',
      9: 'Pacific Southwest',
      10: 'Pacific Northwest',
    };
    return regions[regionNumber] || `Region ${regionNumber}`;
  }

  /**
   * Generate map tile URL
   */
  generateMapUrl(lat, lng) {
    if (!lat || !lng) return null;
    return {
      openstreetmap: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`,
      google: `https://www.google.com/maps?q=${lat},${lng}`,
    };
  }

  /**
   * Fetch data from EPA ECHO API with logging
   */
  async fetchEPAEndpoint(endpoint, params = {}) {
    try {
      const url = `${EPA_ECHO_BASE_URL}${endpoint}`;
      console.log(`[EPA API] Fetching: ${url}`);
      console.log(`[EPA API] Params:`, JSON.stringify(params));

      // Add p_id parameter if registry_id is provided to get specific facility
      const requestParams = {
        output: 'JSON',
        ...params,
      };
      
      // If registry_id is provided, also add p_id to get specific facility (not clusters)
      if (params.registry_id && !params.p_id) {
        requestParams.p_id = params.registry_id;
      }
      
      const response = await axios.get(url, {
        params: requestParams,
        timeout: 15000, // 15 second timeout
      });

      console.log(`[EPA API] Success: ${url} - Status: ${response.status}`);
      
      // Log response structure for debugging
      if (response.data) {
        const dataKeys = Object.keys(response.data);
        console.log(`[EPA API] Response keys:`, dataKeys);
        
        // Check if Results exists and what structure it has
        if (response.data.Results) {
          const results = response.data.Results;
          
          // Check if it's cluster data or facility data
          if (results.ClusterOutput) {
            console.log(`[EPA API] WARNING: Received cluster data instead of facility data. Query may have too many results.`);
            console.log(`[EPA API] QueryRows: ${results.QueryRows || 'N/A'}`);
          }
          
          // Check for Facilities array
          if (results.Facilities) {
            const facilitiesCount = Array.isArray(results.Facilities) 
              ? results.Facilities.length 
              : (results.Facilities ? 1 : 0);
            console.log(`[EPA API] Facilities count: ${facilitiesCount}`);
          }
          
          // Check if Results is an array (some endpoints return arrays)
          if (Array.isArray(results)) {
            console.log(`[EPA API] Results is an array with ${results.length} items`);
          }
        }
        
        // Log a sample of the data structure
        if (dataKeys.length > 0) {
          console.log(`[EPA API] Sample data structure:`, JSON.stringify(response.data).substring(0, 500));
        }
      }
      
      return response.data;
    } catch (error) {
      console.error(`[EPA API] Error fetching ${endpoint}:`, error.message);
      if (error.response) {
        console.error(`[EPA API] Response status: ${error.response.status}`);
        console.error(`[EPA API] Response headers:`, error.response.headers);
        console.error(`[EPA API] Response data:`, JSON.stringify(error.response.data).substring(0, 500));
      } else if (error.request) {
        console.error(`[EPA API] No response received. Request:`, error.request);
      } else {
        console.error(`[EPA API] Error setting up request:`, error.message);
      }
      return null;
    }
  }

  /**
   * Fetch violation history from EPA
   */
  async fetchViolationHistory(registryId) {
    console.log(`[EPA API] Fetching violation history for REGISTRY_ID: ${registryId}`);
    return await this.fetchEPAEndpoint('/echo/echo_rest_services.get_violation_history', {
      registry_id: registryId,
    });
  }

  /**
   * Fetch inspection data from EPA
   */
  async fetchInspections(registryId) {
    console.log(`[EPA API] Fetching inspections for REGISTRY_ID: ${registryId}`);
    return await this.fetchEPAEndpoint('/echo/echo_rest_services.get_inspection', {
      registry_id: registryId,
    });
  }

  /**
   * Fetch enforcement actions from EPA
   */
  async fetchEnforcement(registryId) {
    console.log(`[EPA API] Fetching enforcement actions for REGISTRY_ID: ${registryId}`);
    return await this.fetchEPAEndpoint('/echo/echo_rest_services.get_enforcement', {
      registry_id: registryId,
    });
  }

  /**
   * Fetch NPDES permit details
   */
  async fetchNPDESPermitInfo(npdesId) {
    if (!npdesId) return null;
    console.log(`[EPA API] Fetching NPDES permit info for: ${npdesId}`);
    return await this.fetchEPAEndpoint('/echo/cwa_rest_services.get_facility_info', {
      npdes_id: npdesId,
    });
  }

  /**
   * Fetch effluent chart data
   */
  async fetchEffluentChart(npdesId) {
    if (!npdesId) return null;
    console.log(`[EPA API] Fetching effluent chart for NPDES: ${npdesId}`);
    return await this.fetchEPAEndpoint('/echo/eff_rest_services.get_effluent_chart', {
      npdes_id: npdesId,
    });
  }

  /**
   * Fetch all CWA (Water) data
   */
  async fetchCWAData(registryId, npdesId = null) {
    console.log(`[EPA API] Fetching CWA data for REGISTRY_ID: ${registryId}, NPDES_ID: ${npdesId || 'N/A'}`);
    
    const promises = [
      this.fetchEPAEndpoint('/echo/cwa_rest_services.get_facility_info', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/cwa_rest_services.get_violation_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/cwa_rest_services.get_inspection_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/cwa_rest_services.get_enforcement_history', { registry_id: registryId }),
    ];
    
    if (npdesId) {
      promises.push(this.fetchEffluentChart(npdesId));
      promises.push(this.fetchEPAEndpoint('/echo/cwa_rest_services.get_permit', { npdes_id: npdesId }));
    } else {
      promises.push(Promise.resolve(null));
      promises.push(Promise.resolve(null));
    }
    
    const results = await Promise.allSettled(promises);
    const [facilityInfo, violations, inspections, enforcement, effluentChart, permit] = results.map(r => 
      r.status === 'fulfilled' ? r.value : null
    );

    // Log what we got
    console.log(`[INFO] CWA fetch results for REGISTRY_ID: ${registryId}:`);
    console.log(`  - Facility Info: ${facilityInfo ? '✓' : '✗'} ${facilityInfo ? `(${JSON.stringify(facilityInfo).substring(0, 100)})` : ''}`);
    console.log(`  - Violations: ${violations ? '✓' : '✗'}`);
    console.log(`  - Inspections: ${inspections ? '✓' : '✗'}`);
    console.log(`  - Enforcement: ${enforcement ? '✓' : '✗'}`);
    console.log(`  - Effluent Chart: ${effluentChart ? '✓' : '✗'}`);
    console.log(`  - Permit: ${permit ? '✓' : '✗'}`);

    return {
      facilityInfo,
      violations,
      inspections,
      enforcement,
      effluentChart,
      permit,
    };
  }

  /**
   * Fetch all CAA (Air) data with detailed information
   */
  async fetchCAAData(registryId) {
    console.log(`[EPA API] Fetching comprehensive CAA data for REGISTRY_ID: ${registryId}`);
    
    // First get basic facility info to extract IDs for detailed queries
    const facilityInfo = await this.fetchEPAEndpoint('/echo/ca_rest_services.get_facility_info', { registry_id: registryId });
    
    // Extract IDs from facility info for detailed queries
    const airIds = this.extractAirIds(facilityInfo);
    
    const [
      violations,
      inspections,
      enforcement,
      permitClassifications,
      hpvFlags,
      emissionCategories,
      emissionUnitDetails,
      pollutantReleases,
      permits,
    ] = await Promise.allSettled([
      this.fetchEPAEndpoint('/echo/ca_rest_services.get_violation_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/ca_rest_services.get_inspection_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/ca_rest_services.get_enforcement_history', { registry_id: registryId }),
      // Additional detailed endpoints (if available)
      airIds.airId ? this.fetchEPAEndpoint('/echo/ca_rest_services.get_facility_info', { 
        registry_id: registryId,
        detailed: 'Y' 
      }) : null,
      // HPV flags are usually in facility info
      null, // Will extract from facilityInfo
      // Emission categories and unit details
      airIds.airId ? this.fetchEPAEndpoint('/echo/ca_rest_services.get_emissions', { 
        registry_id: registryId 
      }) : null,
      airIds.airId ? this.fetchEPAEndpoint('/echo/ca_rest_services.get_emission_units', { 
        registry_id: registryId 
      }) : null,
      airIds.airId ? this.fetchEPAEndpoint('/echo/ca_rest_services.get_pollutant_releases', { 
        registry_id: registryId 
      }) : null,
      // Air permits with dates and agency
      airIds.airId ? this.fetchEPAEndpoint('/echo/ca_rest_services.get_permits', { 
        registry_id: registryId 
      }) : null,
    ]);

    // Extract HPV flags and permit classifications from facility info
    const hpvFlagsData = this.extractHPVFlags(facilityInfo);
    const permitClassificationsData = this.extractPermitClassifications(facilityInfo);

    return {
      facilityInfo,
      violations: violations.status === 'fulfilled' ? violations.value : null,
      inspections: inspections.status === 'fulfilled' ? inspections.value : null,
      enforcement: enforcement.status === 'fulfilled' ? enforcement.value : null,
      permitClassifications: permitClassificationsData || (permitClassifications.status === 'fulfilled' ? permitClassifications.value : null),
      hpvFlags: hpvFlagsData,
      emissionCategories: emissionCategories.status === 'fulfilled' ? emissionCategories.value : null,
      emissionUnitDetails: emissionUnitDetails.status === 'fulfilled' ? emissionUnitDetails.value : null,
      pollutantReleases: pollutantReleases.status === 'fulfilled' ? pollutantReleases.value : null,
      permits: permits.status === 'fulfilled' ? permits.value : null,
    };
  }

  /**
   * Extract Air IDs from facility info
   */
  extractAirIds(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return {};
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      airId: results?.AIR_ID || results?.air_id,
      permitId: results?.PERMIT_ID || results?.permit_id,
    };
  }

  /**
   * Extract HPV flags from facility info
   */
  extractHPVFlags(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return null;
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      hpvFlag: results?.HPV_FLAG || results?.hpv_flag,
      hpvStatus: results?.HPV_STATUS || results?.hpv_status,
      majorSource: results?.MAJOR_SOURCE || results?.major_source,
    };
  }

  /**
   * Extract permit classifications from facility info
   */
  extractPermitClassifications(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return null;
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      permitType: results?.PERMIT_TYPE || results?.permit_type,
      permitClassification: results?.PERMIT_CLASSIFICATION || results?.permit_classification,
      permitStatus: results?.PERMIT_STATUS || results?.permit_status,
      permitAgency: results?.PERMIT_AGENCY || results?.permit_agency,
      permitIssueDate: results?.PERMIT_ISSUE_DATE || results?.permit_issue_date,
      permitExpireDate: results?.PERMIT_EXPIRE_DATE || results?.permit_expire_date,
    };
  }

  /**
   * Fetch all RCRA (Hazardous Waste) data with detailed information
   */
  async fetchRCRAData(registryId) {
    console.log(`[EPA API] Fetching comprehensive RCRA data for REGISTRY_ID: ${registryId}`);
    
    const [
      facilityInfo,
      violations,
      inspections,
      enforcement,
    ] = await Promise.all([
      this.fetchEPAEndpoint('/echo/rcr_rest_services.get_facility_info', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/rcr_rest_services.get_violation_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/rcr_rest_services.get_inspection_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/rcr_rest_services.get_enforcement_history', { registry_id: registryId }),
    ]);

    // Extract detailed handler information, generator category, and waste codes from facility info
    const handlerDetails = this.extractRCRADetails(facilityInfo);
    const generatorCategory = this.extractGeneratorCategory(facilityInfo);
    const wasteCodes = this.extractWasteCodes(facilityInfo);

    return {
      facilityInfo,
      violations,
      inspections,
      enforcement,
      handlerDetails,
      generatorCategory,
      wasteCodes,
    };
  }

  /**
   * Extract RCRA handler details
   */
  extractRCRADetails(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return null;
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      handlerType: results?.HANDLER_TYPE || results?.handler_type,
      handlerStatus: results?.HANDLER_STATUS || results?.handler_status,
      handlerName: results?.HANDLER_NAME || results?.handler_name,
      handlerAddress: results?.HANDLER_ADDRESS || results?.handler_address,
      handlerCity: results?.HANDLER_CITY || results?.handler_city,
      handlerState: results?.HANDLER_STATE || results?.handler_state,
      handlerZip: results?.HANDLER_ZIP || results?.handler_zip,
    };
  }

  /**
   * Extract generator category
   */
  extractGeneratorCategory(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return null;
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      generatorStatus: results?.GENERATOR_STATUS || results?.generator_status,
      generatorType: results?.GENERATOR_TYPE || results?.generator_type,
      generatorCategory: results?.GENERATOR_CATEGORY || results?.generator_category,
      largeQuantityGenerator: results?.LQG || results?.lqg,
      smallQuantityGenerator: results?.SQG || results?.sqg,
      verySmallQuantityGenerator: results?.VSQG || results?.vsqg,
    };
  }

  /**
   * Extract waste codes
   */
  extractWasteCodes(facilityInfo) {
    if (!facilityInfo || !facilityInfo.Results) return null;
    
    const results = Array.isArray(facilityInfo.Results) ? facilityInfo.Results[0] : facilityInfo.Results;
    return {
      wasteCodes: results?.WASTE_CODES || results?.waste_codes,
      wasteCodeDescriptions: results?.WASTE_CODE_DESCRIPTIONS || results?.waste_code_descriptions,
      hazardousWasteCodes: results?.HAZARDOUS_WASTE_CODES || results?.hazardous_waste_codes,
    };
  }

  /**
   * Fetch all SDWA (Drinking Water) data
   */
  async fetchSDWAData(registryId) {
    console.log(`[EPA API] Fetching SDWA data for REGISTRY_ID: ${registryId}`);
    const [facilityInfo, violations, enforcement] = await Promise.all([
      this.fetchEPAEndpoint('/echo/dsd_rest_services.get_facility_info', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/dsd_rest_services.get_violation_history', { registry_id: registryId }),
      this.fetchEPAEndpoint('/echo/dsd_rest_services.get_enforcement_history', { registry_id: registryId }),
    ]);

    return {
      facilityInfo,
      violations,
      enforcement,
    };
  }

  /**
   * Fetch TRI data (requires TRIFID from facility info)
   */
  async fetchTRIData(triFacilityId) {
    if (!triFacilityId) return null;
    console.log(`[EPA API] Fetching TRI data for TRIFID: ${triFacilityId}`);
    return await this.fetchEPAEndpoint('/echo/tri_rest_services.get_tri_facility', {
      tri_facility_id: triFacilityId,
    });
  }

  /**
   * Fetch GHG data (requires GHG ID)
   */
  async fetchGHGData(ghgId) {
    if (!ghgId) return null;
    console.log(`[EPA API] Fetching GHG data for GHG ID: ${ghgId}`);
    try {
      const url = `https://api.epa.gov/easey/ghg-facilities-mgmt/facilities/${ghgId}`;
      console.log(`[EPA API] Fetching: ${url}`);
      const response = await axios.get(url, { timeout: 10000 });
      console.log(`[EPA API] Success: ${url} - Status: ${response.status}`);
      return response.data;
    } catch (error) {
      console.error(`[EPA API] Error fetching GHG data:`, error.message);
      return null;
    }
  }

  /**
   * Fetch comprehensive EJScreen data using coordinates (100+ fields)
   */
  async fetchEJScreenData(lat, lng) {
    if (!lat || !lng) return null;
    console.log(`[EPA API] Fetching comprehensive EJScreen data for coordinates: ${lat}, ${lng}`);
    
    const ejscreenData = await this.fetchEPAEndpoint('/echo/ej_rest_services.get_ejscreen', {
      latitude: lat,
      longitude: lng,
    });

    if (!ejscreenData) return null;

    // Extract and organize EJScreen data into categories
    return {
      // Air toxics
      airToxics: this.extractEJScreenCategory(ejscreenData, ['airToxics', 'air_toxics', 'AIR_TOXICS']),
      
      // Water discharge EJ
      waterDischargeEJ: this.extractEJScreenCategory(ejscreenData, ['waterDischargeEJ', 'water_discharge_ej', 'WATER_DISCHARGE_EJ']),
      
      // Climate risk
      climateRisk: this.extractEJScreenCategory(ejscreenData, ['climateRisk', 'climate_risk', 'CLIMATE_RISK']),
      
      // Traffic proximity
      trafficProximity: this.extractEJScreenCategory(ejscreenData, ['trafficProximity', 'traffic_proximity', 'TRAFFIC_PROXIMITY']),
      
      // Lead paint
      leadPaint: this.extractEJScreenCategory(ejscreenData, ['leadPaint', 'lead_paint', 'LEAD_PAINT']),
      
      // Superfund proximity
      superfundProximity: this.extractEJScreenCategory(ejscreenData, ['superfundProximity', 'superfund_proximity', 'SUPERFUND_PROXIMITY']),
      
      // All raw data (100+ fields)
      rawData: ejscreenData,
    };
  }

  /**
   * Extract EJScreen category data
   */
  extractEJScreenCategory(ejscreenData, keys) {
    for (const key of keys) {
      if (ejscreenData[key]) {
        return ejscreenData[key];
      }
    }
    // If category not found, extract related fields
    const categoryFields = {};
    const keyPattern = keys[0].toLowerCase();
    Object.keys(ejscreenData).forEach(field => {
      if (field.toLowerCase().includes(keyPattern)) {
        categoryFields[field] = ejscreenData[field];
      }
    });
    return Object.keys(categoryFields).length > 0 ? categoryFields : null;
  }

  /**
   * Fetch and store all facility details from EPA ECHO API
   */
  async fetchAndStoreFacilityDetails(registryId, facilityData = {}) {
    try {
      console.log(`[INFO] Starting comprehensive data fetch for REGISTRY_ID: ${registryId}`);
      
      const FacilityDetails = await this.getFacilityDetailsModel();
      if (!FacilityDetails) {
        throw new Error('FacilityDetails model not available');
      }

      // Always upsert - find existing or create new
      const iconBaseURL = 'https://echo.epa.gov/themes/custom/echo/images/map/';
      
      // Use findOneAndUpdate with upsert option
      let facilityDetails = await FacilityDetails.findOneAndUpdate(
        { REGISTRY_ID: registryId },
        {
          $setOnInsert: {
            REGISTRY_ID: registryId,
            iconBaseURL: iconBaseURL,
            fetchStatus: new Map(),
            fetchErrors: new Map(),
            createdAt: new Date(),
          },
          $set: {
            iconBaseURL: iconBaseURL, // Always update iconBaseURL
            updatedAt: new Date(),
          },
        },
        { 
          upsert: true, 
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      // Initialize Maps if they don't exist
      if (!facilityDetails.fetchStatus) {
        facilityDetails.fetchStatus = new Map();
      }
      if (!facilityDetails.fetchErrors) {
        facilityDetails.fetchErrors = new Map();
      }

      // Extract IDs and coordinates from facility data
      const npdesId = this.getValue(facilityData, ['NPDES_IDS', 'npdes_ids', 'NPDES_ID', 'npdes_id']);
      const triFacilityId = this.getValue(facilityData, ['TRIFID', 'trifid', 'TRI_FACILITY_ID', 'tri_facility_id']);
      const ghgId = this.getValue(facilityData, ['GHG_ID', 'ghg_id', 'GHGID', 'ghgid']);
      const lat = this.getValue(facilityData, ['FAC_LAT', 'Latitude', 'latitude']);
      const lng = this.getValue(facilityData, ['FAC_LONG', 'Longitude', 'longitude']);

      // Fetch all program data in parallel
      const [
        cwaData,
        caaData,
        rcraData,
        sdwaData,
        triData,
        ghgData,
        ejscreenData,
      ] = await Promise.allSettled([
        this.fetchCWAData(registryId, npdesId),
        this.fetchCAAData(registryId),
        this.fetchRCRAData(registryId),
        this.fetchSDWAData(registryId),
        triFacilityId ? this.fetchTRIData(triFacilityId) : null,
        ghgId ? this.fetchGHGData(ghgId) : null,
        (lat && lng) ? this.fetchEJScreenData(lat, lng) : null,
      ]);

      // Process results and update status with detailed logging
      if (cwaData.status === 'fulfilled') {
        console.log(`[INFO] CWA data fetched successfully for REGISTRY_ID: ${registryId}`);
        console.log(`[INFO] CWA data keys:`, cwaData.value ? Object.keys(cwaData.value) : 'null');
        facilityDetails.cwa = cwaData.value;
        facilityDetails.fetchStatus.set('cwa', 'success');
      } else {
        console.error(`[ERROR] CWA data fetch failed for REGISTRY_ID: ${registryId}`);
        console.error(`[ERROR] CWA error:`, cwaData.reason?.message || cwaData.reason);
        facilityDetails.fetchStatus.set('cwa', 'error');
        facilityDetails.fetchErrors.set('cwa', cwaData.reason?.message || 'Unknown error');
      }

      if (caaData.status === 'fulfilled') {
        console.log(`[INFO] CAA data fetched successfully for REGISTRY_ID: ${registryId}`);
        console.log(`[INFO] CAA data keys:`, caaData.value ? Object.keys(caaData.value) : 'null');
        facilityDetails.caa = caaData.value;
        facilityDetails.fetchStatus.set('caa', 'success');
      } else {
        console.error(`[ERROR] CAA data fetch failed for REGISTRY_ID: ${registryId}`);
        console.error(`[ERROR] CAA error:`, caaData.reason?.message || caaData.reason);
        facilityDetails.fetchStatus.set('caa', 'error');
        facilityDetails.fetchErrors.set('caa', caaData.reason?.message || 'Unknown error');
      }

      if (rcraData.status === 'fulfilled') {
        console.log(`[INFO] RCRA data fetched successfully for REGISTRY_ID: ${registryId}`);
        console.log(`[INFO] RCRA data keys:`, rcraData.value ? Object.keys(rcraData.value) : 'null');
        facilityDetails.rcra = rcraData.value;
        facilityDetails.fetchStatus.set('rcra', 'success');
      } else {
        console.error(`[ERROR] RCRA data fetch failed for REGISTRY_ID: ${registryId}`);
        console.error(`[ERROR] RCRA error:`, rcraData.reason?.message || rcraData.reason);
        facilityDetails.fetchStatus.set('rcra', 'error');
        facilityDetails.fetchErrors.set('rcra', rcraData.reason?.message || 'Unknown error');
      }

      if (sdwaData.status === 'fulfilled') {
        facilityDetails.sdwa = sdwaData.value;
        facilityDetails.fetchStatus.set('sdwa', 'success');
      } else {
        facilityDetails.fetchStatus.set('sdwa', 'error');
        facilityDetails.fetchErrors.set('sdwa', sdwaData.reason?.message || 'Unknown error');
      }

      if (triData.status === 'fulfilled' && triData.value) {
        facilityDetails.tri = {
          facilityInfo: triData.value,
          triFacilityId: triFacilityId,
        };
        facilityDetails.fetchStatus.set('tri', 'success');
      } else if (triFacilityId) {
        facilityDetails.fetchStatus.set('tri', 'error');
        facilityDetails.fetchErrors.set('tri', triData.reason?.message || 'Unknown error');
      }

      if (ghgData.status === 'fulfilled' && ghgData.value) {
        facilityDetails.ghg = {
          facilityInfo: ghgData.value,
          ghgId: ghgId,
        };
        facilityDetails.fetchStatus.set('ghg', 'success');
      } else if (ghgId) {
        facilityDetails.fetchStatus.set('ghg', 'error');
        facilityDetails.fetchErrors.set('ghg', ghgData.reason?.message || 'Unknown error');
      }

      if (ejscreenData.status === 'fulfilled' && ejscreenData.value) {
        facilityDetails.ejscreen = ejscreenData.value;
        facilityDetails.fetchStatus.set('ejscreen', 'success');
      } else if (lat && lng) {
        facilityDetails.fetchStatus.set('ejscreen', 'error');
        facilityDetails.fetchErrors.set('ejscreen', ejscreenData.reason?.message || 'Unknown error');
      }

      // Set DFR URL
      facilityDetails.dfrUrl = `https://echo.epa.gov/detailed-facility-report?fid=${registryId}`;
      facilityDetails.lastFetched = new Date();

      // Always upsert - save to database
      await facilityDetails.save();
      console.log(`[INFO] Successfully upserted facility details for REGISTRY_ID: ${registryId}`);

      return facilityDetails;
    } catch (error) {
      console.error(`[ERROR] Error fetching/storing facility details for ${registryId}:`, error);
      throw error;
    }
  }

  /**
   * Extract violations from facility data
   */
  extractViolations(facilities) {
    const violations = [];
    let violationIdCounter = 1;

    facilities.forEach((facility, index) => {
      // Database stores data directly on facility, not in facilityData
      const facilityData = facility;
      const registryId = String(facility.REGISTRY_ID || facility.FRS_ID || '');

      // Check for violations array
      const violationsArray = this.getValue(facilityData, [
        'violations', 'Violations', 'VIOLATIONS', 'violation', 'Violation'
      ]);

      if (Array.isArray(violationsArray)) {
        violationsArray.forEach(viol => {
          violations.push({
            id: this.getValue(viol, ['id', 'ID', 'violationId', 'violation_id']) || `VIO-${new Date().getFullYear()}-${String(violationIdCounter++).padStart(3, '0')}`,
            facilityId: registryId,
            program: this.getValue(viol, ['program', 'Program', 'PROGRAM']) || 
                    this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || 'UNKNOWN',
            violationType: this.getValue(viol, ['violationType', 'type', 'Type', 'violation_type', 'description', 'Description']),
            type: this.getValue(viol, ['violationType', 'type', 'Type', 'violation_type', 'description', 'Description']),
            description: this.getValue(viol, ['description', 'Description', 'DESCRIPTION', 'details', 'Details']),
            date: this.getValue(viol, ['date', 'Date', 'DATE', 'violationDate', 'violation_date']),
            severity: this.getValue(viol, ['severity', 'Severity', 'SEVERITY', 'level', 'Level']),
            status: this.getValue(viol, ['status', 'Status', 'STATUS', 'violationStatus', 'violation_status']) || 'Open',
            penalty: this.getValue(viol, ['penalty', 'Penalty', 'PENALTY', 'fine', 'Fine', 'amount', 'Amount']),
            fine: this.getValue(viol, ['fine', 'Fine', 'FINE', 'penalty', 'Penalty']),
            resolved: this.getValue(viol, ['resolved', 'Resolved', 'RESOLVED']) || false,
            resolvedDate: this.getValue(viol, ['resolvedDate', 'resolved_date', 'resolvedDate', 'resolved_date']),
            finding: this.getValue(viol, ['finding', 'Finding', 'FINDING', 'result', 'Result']),
          });
        });
      }

      // Check for single violation fields
      if (facilityData.CURRENT_VIOL === 'Y' || facilityData.currentViol === 'Y' || facilityData.Current_Viol === 'Y') {
        violations.push({
          id: `VIO-${new Date().getFullYear()}-${String(violationIdCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          program: this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || 'UNKNOWN',
          violationType: 'Current Violation',
          type: 'Current Violation',
          description: this.getValue(facilityData, ['violationDescription', 'violation_description', 'description', 'Description']) || 'Current violation detected',
          date: this.getValue(facilityData, ['violationDate', 'violation_date', 'date', 'Date']),
          severity: 'Significant',
          status: 'Open',
          penalty: this.getValue(facilityData, ['penalty', 'Penalty', 'totalPenalties', 'total_penalties']),
          fine: null,
          resolved: false,
          resolvedDate: null,
          finding: 'Significant Noncompliance',
        });
      }
    });

    return violations;
  }

  /**
   * Extract inspections from facility data
   */
  extractInspections(facilities) {
    const inspections = [];
    let inspectionIdCounter = 1;

    facilities.forEach((facility) => {
      // Database stores data directly on facility, not in facilityData
      const facilityData = facility;
      const registryId = String(facility.REGISTRY_ID || facility.FRS_ID || '');

      // Check for inspections array
      const inspectionsArray = this.getValue(facilityData, [
        'inspections', 'Inspections', 'INSPECTIONS', 'inspection', 'Inspection'
      ]);

      if (Array.isArray(inspectionsArray)) {
        inspectionsArray.forEach(ins => {
          inspections.push({
            id: this.getValue(ins, ['id', 'ID', 'inspectionId', 'inspection_id']) || `INS-${new Date().getFullYear()}-${String(inspectionIdCounter++).padStart(2, '0')}`,
            facilityId: registryId,
            date: this.getValue(ins, ['date', 'Date', 'DATE', 'inspectionDate', 'inspection_date']),
            type: this.getValue(ins, ['type', 'Type', 'TYPE', 'inspectionType', 'inspection_type']),
            program: this.getValue(ins, ['program', 'Program', 'PROGRAM']) || 
                    this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || 'UNKNOWN',
            findings: this.getValue(ins, ['findings', 'Findings', 'FINDINGS', 'result', 'Result', 'finding', 'Finding']),
            violations: this.getValue(ins, ['violations', 'Violations', 'violationCount', 'violation_count'], 0),
            result: this.getValue(ins, ['result', 'Result', 'RESULT', 'findings', 'Findings']),
            inspector: this.getValue(ins, ['inspector', 'Inspector', 'INSPECTOR', 'inspectorName', 'inspector_name']),
            summary: this.getValue(ins, ['summary', 'Summary', 'SUMMARY', 'description', 'Description']),
          });
        });
      }

      // Extract inspection dates from facility data
      const epaInspectionDate = this.getValue(facilityData, [
        'FAC_DATE_LAST_INSPECTION_EPA', 'fac_date_last_inspection_epa', 
        'lastInspectionEPA', 'last_inspection_epa', 'epaInspectionDate', 'epa_inspection_date'
      ]);
      const stateInspectionDate = this.getValue(facilityData, [
        'FAC_DATE_LAST_INSPECTION_STATE', 'fac_date_last_inspection_state',
        'lastInspectionState', 'last_inspection_state', 'stateInspectionDate', 'state_inspection_date'
      ]);

      if (epaInspectionDate) {
        inspections.push({
          id: `INS-${new Date().getFullYear()}-${String(inspectionIdCounter++).padStart(2, '0')}`,
          facilityId: registryId,
          date: epaInspectionDate,
          type: 'Compliance Evaluation Inspection',
          program: this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || 'UNKNOWN',
          findings: this.getValue(facilityData, ['FAC_COMPLIANCE_STATUS', 'fac_compliance_status', 'complianceStatus', 'compliance_status']) || 'No Violations',
          violations: this.getValue(facilityData, ['violationCount', 'violation_count', 'QTRS_WITH_NC', 'qtrs_with_nc'], 0),
          result: this.getValue(facilityData, ['FAC_COMPLIANCE_STATUS', 'fac_compliance_status', 'complianceStatus', 'compliance_status']) || 'No Violations',
          inspector: 'EPA',
          summary: 'EPA compliance inspection',
        });
      }

      if (stateInspectionDate) {
        inspections.push({
          id: `INS-${new Date().getFullYear()}-${String(inspectionIdCounter++).padStart(2, '0')}`,
          facilityId: registryId,
          date: stateInspectionDate,
          type: 'State Inspection',
          program: this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || 'UNKNOWN',
          findings: 'No Violations',
          violations: 0,
          result: 'No Violations',
          inspector: 'State EPA',
          summary: 'State compliance inspection',
        });
      }
    });

    // Sort by date descending
    return inspections.sort((a, b) => {
      const dateA = new Date(a.date || 0);
      const dateB = new Date(b.date || 0);
      return dateB - dateA;
    });
  }

  /**
   * Extract permits from facility data
   */
  extractPermits(facilities) {
    const permits = [];

    facilities.forEach((facility) => {
      // Database stores data directly on facility, not in facilityData
      const facilityData = facility;
      const sourceType = this.getValue(facility.source, ['type', 'Type'])?.toUpperCase() || '';

      // Check for permits array
      const permitsArray = this.getValue(facilityData, [
        'permits', 'Permits', 'PERMITS', 'permit', 'Permit'
      ]);

      if (Array.isArray(permitsArray)) {
        permitsArray.forEach(perm => {
          permits.push({
            type: this.getValue(perm, ['type', 'Type', 'TYPE', 'permitType', 'permit_type']) || 
                  (sourceType === 'CWA' ? 'NPDES Permit' : sourceType === 'CAA' ? 'Air Permit' : sourceType === 'RCRA' ? 'RCRA Permit' : 'Permit'),
            number: this.getValue(perm, ['number', 'Number', 'NUMBER', 'permitNumber', 'permit_number', 'permitno', 'permit_no']),
            issueDate: this.getValue(perm, ['issueDate', 'issue_date', 'issuedDate', 'issued_date', 'date', 'Date']),
            expiryDate: this.getValue(perm, ['expiryDate', 'expiry_date', 'expirationDate', 'expiration_date', 'expires', 'Expires']),
            expirationDate: this.getValue(perm, ['expiryDate', 'expiry_date', 'expirationDate', 'expiration_date', 'expires', 'Expires']),
            status: this.getValue(perm, ['status', 'Status', 'STATUS', 'permitStatus', 'permit_status']) || 'Active',
            program: sourceType || this.getValue(perm, ['program', 'Program', 'PROGRAM']),
          });
        });
      }

      // Extract permit info from individual fields
      const permitNumber = this.getValue(facilityData, [
        'permitNumber', 'permit_number', 'PERMIT_NUMBER', 'permitno', 'permit_no', 'PERMITNO'
      ]);
      if (permitNumber) {
        permits.push({
          type: sourceType === 'CWA' ? 'NPDES Permit' : sourceType === 'CAA' ? 'Air Permit' : sourceType === 'RCRA' ? 'RCRA Permit' : 'Permit',
          number: permitNumber,
          issueDate: this.getValue(facilityData, ['issueDate', 'issue_date', 'issuedDate', 'issued_date']),
          expiryDate: this.getValue(facilityData, ['expiryDate', 'expiry_date', 'expirationDate', 'expiration_date']),
          expirationDate: this.getValue(facilityData, ['expiryDate', 'expiry_date', 'expirationDate', 'expiration_date']),
          status: 'Active',
          program: sourceType,
        });
      }
    });

    return permits;
  }

  /**
   * Format programs array with code and programDesc
   */
  formatPrograms(facilityData) {
    const programMap = {
      'NPDES': 'National Pollutant Discharge Elimination System',
      'CAA': 'Clean Air Act',
      'RCRA': 'Resource Conservation and Recovery Act',
      'TRI': 'Toxic Release Inventory',
      'GHG': 'Greenhouse Gas Reporting',
      'SDWIS': 'Safe Drinking Water Information System',
    };

    const programs = [];
    
    // Check flags
    if (this.getValue(facilityData, ['NPDES_FLAG', 'npdes_flag']) === 'Y') {
      programs.push({ code: 'NPDES', programDesc: programMap['NPDES'] });
    }
    if (this.getValue(facilityData, ['AIR_FLAG', 'air_flag']) === 'Y') {
      programs.push({ code: 'CAA', programDesc: programMap['CAA'] });
    }
    if (this.getValue(facilityData, ['RCRA_FLAG', 'rcra_flag']) === 'Y') {
      programs.push({ code: 'RCRA', programDesc: programMap['RCRA'] });
    }
    if (this.getValue(facilityData, ['TRI_FLAG', 'tri_flag']) === 'Y') {
      programs.push({ code: 'TRI', programDesc: programMap['TRI'] });
    }
    if (this.getValue(facilityData, ['GHG_FLAG', 'ghg_flag']) === 'Y') {
      programs.push({ code: 'GHG', programDesc: programMap['GHG'] });
    }
    if (this.getValue(facilityData, ['SDWIS_FLAG', 'sdwis_flag']) === 'Y') {
      programs.push({ code: 'SDWIS', programDesc: programMap['SDWIS'] });
    }

    return programs;
  }

  /**
   * Format permits with detailed information
   */
  formatPermits(facilityData, storedDetails) {
    if (!facilityData) return [];
    const permits = [];
    const programMap = {
      'CWA': 'National Pollutant Discharge Elimination System',
      'CAA': 'Clean Air Act',
      'RCRA': 'Resource Conservation and Recovery Act',
    };

    // NPDES Permit
    const npdesId = this.getValue(facilityData, ['NPDES_IDS', 'npdes_ids', 'NPDES_ID', 'npdes_id']);
    if (npdesId) {
      const cwaData = storedDetails?.cwa?.facilityInfo;
      const permitTypes = this.getValue(facilityData, ['CWA_PERMIT_TYPES', 'cwa_permit_types']);
      
      permits.push({
        type: 'NPDES Permit',
        number: String(npdesId),
        issueDate: this.extractDateFromEPA(cwaData, 'issueDate', 'ISSUE_DATE') || null,
        expiryDate: this.extractDateFromEPA(cwaData, 'expiryDate', 'EXPIRE_DATE') || null,
        expirationDate: this.extractDateFromEPA(cwaData, 'expiryDate', 'EXPIRE_DATE') || null,
        status: 'Active',
        program: 'CWA',
        programDesc: programMap['CWA'],
        components: permitTypes ? [{ componentType: String(permitTypes), description: String(permitTypes) }] : [],
        featureCoordinates: this.extractCoordinates(facilityData),
      });
    }

    // Air Permit
    const airId = this.getValue(facilityData, ['AIR_IDS', 'air_ids', 'AIR_ID', 'air_id']);
    if (airId) {
      const caaData = storedDetails?.caa?.facilityInfo;
      permits.push({
        type: 'Air Permit',
        number: String(airId),
        issueDate: this.extractDateFromEPA(caaData, 'issueDate', 'ISSUE_DATE') || null,
        expiryDate: this.extractDateFromEPA(caaData, 'expiryDate', 'EXPIRE_DATE') || null,
        expirationDate: this.extractDateFromEPA(caaData, 'expiryDate', 'EXPIRE_DATE') || null,
        status: 'Active',
        program: 'CAA',
        programDesc: programMap['CAA'],
      });
    }

    // RCRA Permit
    const rcraId = this.getValue(facilityData, ['RCRA_IDS', 'rcra_ids', 'RCRA_ID', 'rcra_id']);
    if (rcraId) {
      const rcraData = storedDetails?.rcra?.facilityInfo;
      permits.push({
        type: 'RCRA Permit',
        number: String(rcraId),
        issueDate: this.extractDateFromEPA(rcraData, 'issueDate', 'ISSUE_DATE') || null,
        expiryDate: this.extractDateFromEPA(rcraData, 'expiryDate', 'EXPIRE_DATE') || null,
        expirationDate: this.extractDateFromEPA(rcraData, 'expiryDate', 'EXPIRE_DATE') || null,
        status: 'Active',
        program: 'RCRA',
        programDesc: programMap['RCRA'],
      });
    }

    return permits;
  }

  /**
   * Extract date from EPA API response
   */
  extractDateFromEPA(epaData, ...keys) {
    if (!epaData) return null;
    const results = Array.isArray(epaData?.Results) ? epaData.Results[0] : epaData?.Results;
    return this.getValue(results, keys) || null;
  }

  /**
   * Extract coordinates for featureCoordinates
   */
  extractCoordinates(facilityData) {
    const lat = this.getValue(facilityData, ['FAC_LAT', 'Latitude', 'latitude']);
    const lng = this.getValue(facilityData, ['FAC_LONG', 'Longitude', 'longitude']);
    if (lat && lng) {
      return [{
        latitude: parseFloat(lat),
        longitude: parseFloat(lng),
        featureNumber: '001',
      }];
    }
    return [];
  }

  /**
   * Format violations with detailed information
   */
  formatViolations(facilityData, storedDetails) {
    if (!storedDetails) return [];
    const violations = [];
    const registryId = String(facilityData.REGISTRY_ID || facilityData.FRS_ID || '');
    let violationCounter = 1;

    // Extract from CWA data
    const cwaViolations = storedDetails?.cwa?.violations;
    if (cwaViolations?.Results) {
      const results = Array.isArray(cwaViolations.Results) ? cwaViolations.Results : [cwaViolations.Results];
      results.forEach(v => {
        violations.push({
          id: `VIO-${registryId}-${String(violationCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          program: 'NPDES',
          violationType: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          type: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          description: v.Description || v.DESCRIPTION || '',
          date: v.ViolationDate || v.VIOLATION_DATE || v.Date || v.DATE,
          severity: v.Severity || v.SEVERITY || 'Moderate',
          status: v.Status || v.STATUS || 'Open',
          penalty: parseFloat(v.Penalty || v.PENALTY || 0),
          fine: v.Fine || v.FINE || null,
          resolved: v.Resolved || v.RESOLVED || false,
          resolvedDate: v.ResolvedDate || v.RESOLVED_DATE || null,
          finding: v.Finding || v.FINDING || '',
          violationCode: v.ViolationCode || v.VIOLATION_CODE || null,
          violationCategory: v.ViolationCategory || v.VIOLATION_CATEGORY || null,
          qncrHistory: this.extractQncrHistoryFromViolation(v),
        });
      });
    }

    // Extract from CAA data
    const caaViolations = storedDetails?.caa?.violations;
    if (caaViolations?.Results) {
      const results = Array.isArray(caaViolations.Results) ? caaViolations.Results : [caaViolations.Results];
      results.forEach(v => {
        violations.push({
          id: `VIO-${registryId}-${String(violationCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          program: 'CAA',
          violationType: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          type: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          description: v.Description || v.DESCRIPTION || '',
          date: v.ViolationDate || v.VIOLATION_DATE || v.Date || v.DATE,
          severity: v.Severity || v.SEVERITY || 'Moderate',
          status: v.Status || v.STATUS || 'Open',
          penalty: parseFloat(v.Penalty || v.PENALTY || 0),
          fine: v.Fine || v.FINE || null,
          resolved: v.Resolved || v.RESOLVED || false,
          resolvedDate: v.ResolvedDate || v.RESOLVED_DATE || null,
          finding: v.Finding || v.FINDING || '',
          violationCode: v.ViolationCode || v.VIOLATION_CODE || null,
        });
      });
    }

    // Extract from RCRA data
    const rcraViolations = storedDetails?.rcra?.violations;
    if (rcraViolations?.Results) {
      const results = Array.isArray(rcraViolations.Results) ? rcraViolations.Results : [rcraViolations.Results];
      results.forEach(v => {
        violations.push({
          id: `VIO-${registryId}-${String(violationCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          program: 'RCRA',
          violationType: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          type: v.ViolationType || v.VIOLATION_TYPE || 'Unknown',
          description: v.Description || v.DESCRIPTION || '',
          date: v.ViolationDate || v.VIOLATION_DATE || v.Date || v.DATE,
          severity: v.Severity || v.SEVERITY || 'Moderate',
          status: v.Status || v.STATUS || 'Open',
          penalty: parseFloat(v.Penalty || v.PENALTY || 0),
          fine: v.Fine || v.FINE || null,
          resolved: v.Resolved || v.RESOLVED || false,
          resolvedDate: v.ResolvedDate || v.RESOLVED_DATE || null,
          finding: v.Finding || v.FINDING || '',
        });
      });
    }

    return violations;
  }

  /**
   * Extract QNCR history from violation
   */
  extractQncrHistoryFromViolation(violation) {
    // This would extract QNCR history if available in violation data
    return null;
  }

  /**
   * Format inspections with detailed information
   */
  formatInspections(facilityData, storedDetails) {
    if (!storedDetails) return [];
    const inspections = [];
    const registryId = String(facilityData.REGISTRY_ID || facilityData.FRS_ID || '');
    let inspectionCounter = 1;

    // Extract from CWA data
    const cwaInspections = storedDetails?.cwa?.inspections;
    if (cwaInspections?.Results) {
      const results = Array.isArray(cwaInspections.Results) ? cwaInspections.Results : [cwaInspections.Results];
      results.forEach(ins => {
        inspections.push({
          id: `INS-${registryId}-${String(inspectionCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          date: ins.InspectionDate || ins.INSPECTION_DATE || ins.Date || ins.DATE,
          type: ins.InspectionType || ins.INSPECTION_TYPE || ins.Type || ins.TYPE || 'Compliance Evaluation Inspection',
          program: 'NPDES',
          findings: ins.Findings || ins.FINDINGS || ins.Result || ins.RESULT || 'No Violations',
          violations: parseInt(ins.Violations || ins.VIOLATIONS || ins.ViolationCount || ins.VIOLATION_COUNT || 0),
          result: ins.Result || ins.RESULT || ins.Findings || ins.FINDINGS || 'No Violations',
          inspector: ins.Inspector || ins.INSPECTOR || ins.InspectorName || ins.INSPECTOR_NAME || '',
          summary: ins.Summary || ins.SUMMARY || ins.Description || ins.DESCRIPTION || '',
          activityId: ins.ActivityId || ins.ACTIVITY_ID || ins.ActivityID || null,
          agencyType: ins.AgencyType || ins.AGENCY_TYPE || ins.Agency || ins.AGENCY || 'EPA',
          monitorType: ins.MonitorType || ins.MONITOR_TYPE || null,
        });
      });
    }

    // Extract from CAA data
    const caaInspections = storedDetails?.caa?.inspections;
    if (caaInspections?.Results) {
      const results = Array.isArray(caaInspections.Results) ? caaInspections.Results : [caaInspections.Results];
      results.forEach(ins => {
        inspections.push({
          id: `INS-${registryId}-${String(inspectionCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          date: ins.InspectionDate || ins.INSPECTION_DATE || ins.Date || ins.DATE,
          type: ins.InspectionType || ins.INSPECTION_TYPE || ins.Type || ins.TYPE || 'Air Site Inspection',
          program: 'CAA',
          findings: ins.Findings || ins.FINDINGS || ins.Result || ins.RESULT || 'No Violations',
          violations: parseInt(ins.Violations || ins.VIOLATIONS || ins.ViolationCount || ins.VIOLATION_COUNT || 0),
          result: ins.Result || ins.RESULT || ins.Findings || ins.FINDINGS || 'No Violations',
          inspector: ins.Inspector || ins.INSPECTOR || ins.InspectorName || ins.INSPECTOR_NAME || '',
          summary: ins.Summary || ins.SUMMARY || ins.Description || ins.DESCRIPTION || '',
          activityId: ins.ActivityId || ins.ACTIVITY_ID || ins.ActivityID || null,
          agencyType: ins.AgencyType || ins.AGENCY_TYPE || ins.Agency || ins.AGENCY || 'EPA',
        });
      });
    }

    // Extract from RCRA data
    const rcraInspections = storedDetails?.rcra?.inspections;
    if (rcraInspections?.Results) {
      const results = Array.isArray(rcraInspections.Results) ? rcraInspections.Results : [rcraInspections.Results];
      results.forEach(ins => {
        inspections.push({
          id: `INS-${registryId}-${String(inspectionCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          date: ins.InspectionDate || ins.INSPECTION_DATE || ins.Date || ins.DATE,
          type: ins.InspectionType || ins.INSPECTION_TYPE || ins.Type || ins.TYPE || 'RCRA Compliance Inspection',
          program: 'RCRA',
          findings: ins.Findings || ins.FINDINGS || ins.Result || ins.RESULT || 'No Violations',
          violations: parseInt(ins.Violations || ins.VIOLATIONS || ins.ViolationCount || ins.VIOLATION_COUNT || 0),
          result: ins.Result || ins.RESULT || ins.Findings || ins.FINDINGS || 'No Violations',
          inspector: ins.Inspector || ins.INSPECTOR || ins.InspectorName || ins.INSPECTOR_NAME || '',
          summary: ins.Summary || ins.SUMMARY || ins.Description || ins.DESCRIPTION || '',
          activityId: ins.ActivityId || ins.ACTIVITY_ID || ins.ActivityID || null,
          agencyType: ins.AgencyType || ins.AGENCY_TYPE || ins.Agency || ins.AGENCY || 'EPA',
        });
      });
    }

    return inspections;
  }

  /**
   * Format enforcement actions with detailed information
   */
  formatEnforcementActions(facilityData, storedDetails) {
    if (!storedDetails) return [];
    const enforcementActions = [];
    const registryId = String(facilityData.REGISTRY_ID || facilityData.FRS_ID || '');
    let enforcementCounter = 1;

    // Extract from CWA data
    const cwaEnforcement = storedDetails?.cwa?.enforcement;
    if (cwaEnforcement?.Results) {
      const results = Array.isArray(cwaEnforcement.Results) ? cwaEnforcement.Results : [cwaEnforcement.Results];
      results.forEach(enf => {
        enforcementActions.push({
          id: `ENF-${registryId}-${String(enforcementCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          type: enf.Type || enf.TYPE || enf.EnforcementType || enf.ENFORCEMENT_TYPE || 'Formal',
          program: 'NPDES',
          date: enf.Date || enf.DATE || enf.EnforcementDate || enf.ENFORCEMENT_DATE,
          agency: enf.Agency || enf.AGENCY || enf.AgencyType || enf.AGENCY_TYPE || 'EPA',
          enfIdentifier: enf.EnfIdentifier || enf.ENF_IDENTIFIER || enf.Identifier || enf.IDENTIFIER || null,
          activityId: enf.ActivityId || enf.ACTIVITY_ID || enf.ActivityID || null,
          actionType: enf.ActionType || enf.ACTION_TYPE || enf.Type || enf.TYPE || '',
          penaltyAmount: parseFloat(enf.PenaltyAmount || enf.PENALTY_AMOUNT || enf.Penalty || enf.PENALTY || 0),
          description: enf.Description || enf.DESCRIPTION || '',
          status: enf.Status || enf.STATUS || 'Active',
        });
      });
    }

    // Extract from CAA data
    const caaEnforcement = storedDetails?.caa?.enforcement;
    if (caaEnforcement?.Results) {
      const results = Array.isArray(caaEnforcement.Results) ? caaEnforcement.Results : [caaEnforcement.Results];
      results.forEach(enf => {
        enforcementActions.push({
          id: `ENF-${registryId}-${String(enforcementCounter++).padStart(3, '0')}`,
          facilityId: registryId,
          type: enf.Type || enf.TYPE || enf.EnforcementType || enf.ENFORCEMENT_TYPE || 'Informal',
          program: 'CAA',
          date: enf.Date || enf.DATE || enf.EnforcementDate || enf.ENFORCEMENT_DATE,
          agency: enf.Agency || enf.AGENCY || enf.AgencyType || enf.AGENCY_TYPE || 'EPA',
          enfIdentifier: enf.EnfIdentifier || enf.ENF_IDENTIFIER || enf.Identifier || enf.IDENTIFIER || null,
          activityId: enf.ActivityId || enf.ACTIVITY_ID || enf.ActivityID || null,
          actionType: enf.ActionType || enf.ACTION_TYPE || enf.Type || enf.TYPE || '',
          penaltyAmount: parseFloat(enf.PenaltyAmount || enf.PENALTY_AMOUNT || enf.Penalty || enf.PENALTY || 0),
          description: enf.Description || enf.DESCRIPTION || '',
          status: enf.Status || enf.STATUS || 'Active',
        });
      });
    }

    return enforcementActions;
  }

  /**
   * Format emissions data
   */
  formatEmissions(storedDetails) {
    if (!storedDetails) return [];
    const emissions = [];
    
    // Extract from TRI data
    const triData = storedDetails?.tri?.facilityInfo;
    if (triData?.Results) {
      const results = Array.isArray(triData.Results) ? triData.Results : [triData.Results];
      results.forEach(r => {
        if (r.ChemicalName && r.TotalReleases) {
          emissions.push({
            year: parseInt(r.Year || new Date().getFullYear()),
            pollutant: r.ChemicalName || r.CHEMICAL_NAME,
            amount: parseFloat(r.TotalReleases || r.TOTAL_RELEASES || 0),
            unit: r.Unit || r.UNIT || 'lbs',
            program: 'TRI',
          });
        }
      });
    }

    // Extract from GHG data
    const ghgData = storedDetails?.ghg?.facilityInfo;
    if (ghgData) {
      // Add GHG emissions if available
    }

    return emissions;
  }

  /**
   * Format stack tests
   */
  formatStackTests(storedDetails) {
    if (!storedDetails) return [];
    const stackTests = [];
    const caaData = storedDetails?.caa?.facilityInfo;
    
    // Extract stack test data from CAA facility info if available
    if (caaData?.Results) {
      const results = Array.isArray(caaData.Results) ? caaData.Results : [caaData.Results];
      results.forEach(r => {
        if (r.StackTestDate || r.STACK_TEST_DATE) {
          stackTests.push({
            id: `ST-${r.RegistryId || r.REGISTRY_ID}-${stackTests.length + 1}`,
            facilityId: String(r.RegistryId || r.REGISTRY_ID || ''),
            date: r.StackTestDate || r.STACK_TEST_DATE,
            type: 'Stack Test',
            program: 'CAA',
            result: r.StackTestResult || r.STACK_TEST_RESULT || 'Pass',
            pollutants: r.Pollutants ? (Array.isArray(r.Pollutants) ? r.Pollutants : [r.Pollutants]) : [],
            activityId: r.ActivityId || r.ACTIVITY_ID || null,
          });
        }
      });
    }

    return stackTests;
  }

  /**
   * Format Title V Certifications
   */
  formatTitleVCerts(storedDetails) {
    if (!storedDetails) return [];
    const titleVCerts = [];
    const caaData = storedDetails?.caa?.facilityInfo;
    
    if (caaData?.Results) {
      const results = Array.isArray(caaData.Results) ? caaData.Results : [caaData.Results];
      results.forEach(r => {
        if (r.TitleVCertDate || r.TITLE_V_CERT_DATE) {
          titleVCerts.push({
            id: `TVC-${r.RegistryId || r.REGISTRY_ID}-${titleVCerts.length + 1}`,
            facilityId: String(r.RegistryId || r.REGISTRY_ID || ''),
            date: r.TitleVCertDate || r.TITLE_V_CERT_DATE,
            type: 'Title V Certification',
            program: 'CAA',
            status: r.TitleVCertStatus || r.TITLE_V_CERT_STATUS || 'Certified',
            activityId: r.ActivityId || r.ACTIVITY_ID || null,
          });
        }
      });
    }

    return titleVCerts;
  }

  /**
   * Format pollutants
   */
  formatPollutants(storedDetails) {
    if (!storedDetails) return [];
    const pollutants = [];
    
    // Extract from CAA data
    const caaData = storedDetails?.caa?.facilityInfo;
    if (caaData?.Results) {
      const results = Array.isArray(caaData.Results) ? caaData.Results : [caaData.Results];
      results.forEach(r => {
        if (r.PollutantCode || r.POLLUTANT_CODE) {
          pollutants.push({
            code: r.PollutantCode || r.POLLUTANT_CODE,
            name: r.PollutantName || r.POLLUTANT_NAME || '',
            program: 'CAA',
            srsId: r.SRSId || r.SRS_ID || null,
          });
        }
      });
    }

    return pollutants;
  }

  /**
   * Format data groups
   */
  formatDataGroups(storedDetails) {
    if (!storedDetails) return [];
    const dataGroups = [];
    const cwaData = storedDetails?.cwa?.facilityInfo;
    
    if (cwaData?.Results) {
      const results = Array.isArray(cwaData.Results) ? cwaData.Results : [cwaData.Results];
      results.forEach(r => {
        if (r.DataGroupCode || r.DATA_GROUP_CODE) {
          dataGroups.push({
            permitNumber: r.PermitNumber || r.PERMIT_NUMBER || r.NPDESId || r.NPDES_ID || '',
            dataGroupCode: r.DataGroupCode || r.DATA_GROUP_CODE,
            description: r.DataGroupDescription || r.DATA_GROUP_DESCRIPTION || '',
            version: parseInt(r.Version || r.VERSION || 0),
          });
        }
      });
    }

    return dataGroups;
  }

  /**
   * Extract enforcement date from stored details
   */
  extractEnforcementDate(storedDetails, type, agency) {
    if (!storedDetails) return null;
    
    // Check CWA enforcement
    const cwaEnf = storedDetails.cwa?.enforcement;
    if (cwaEnf?.Results) {
      const results = Array.isArray(cwaEnf.Results) ? cwaEnf.Results : [cwaEnf.Results];
      const matching = results.filter(r => {
        const enfType = (r.Type || r.TYPE || '').toLowerCase();
        const enfAgency = (r.Agency || r.AGENCY || '').toLowerCase();
        return enfType.includes(type.toLowerCase()) && enfAgency.includes(agency.toLowerCase());
      });
      if (matching.length > 0) {
        return matching[0].Date || matching[0].DATE || matching[0].EnforcementDate || matching[0].ENFORCEMENT_DATE;
      }
    }
    
    return null;
  }

  /**
   * Format QNCR history
   */
  formatQncrHistory(facilityData, storedDetails) {
    const qncrHistory = [];
    
    // Extract from CWA 13 quarters history
    const historyString = this.getValue(facilityData, ['CWA_13QTRS_COMPL_HISTORY', 'cwa_13qtrs_compl_history']);
    if (historyString && typeof historyString === 'string') {
      for (let i = 0; i < historyString.length; i++) {
        const char = historyString[i];
        const year = new Date().getFullYear();
        const quarter = Math.floor(i / 4) + 1;
        const yearQtr = `${year}${quarter}`;
        
        qncrHistory.push({
          yearQtr: yearQtr,
          status: char === '_' ? 'C' : (char === 'V' ? 'NC' : (char === 'S' ? 'SNC' : char)),
          numE90Q: char === 'V' || char === 'S' ? 1 : 0,
          numCvdt: 0,
        });
      }
    }

    return qncrHistory;
  }

  /**
   * Format raw data
   */
  formatRawData(facilityData) {
    return {
      REGISTRY_ID: facilityData.REGISTRY_ID || null,
      FAC_NAME: facilityData.name || facilityData.FacilityName || null,
      FAC_STREET: facilityData.FAC_STREET || facilityData.Street || null,
      FAC_CITY: facilityData.FAC_CITY || facilityData.City || null,
      FAC_STATE: facilityData.FAC_STATE || facilityData.State || null,
      FAC_ZIP: facilityData.FAC_ZIP || facilityData.Zip || null,
      FAC_COUNTY: facilityData.FAC_COUNTY || facilityData.County || null,
      FAC_FIPS_CODE: facilityData.FAC_FIPS_CODE || null,
      FAC_EPA_REGION: facilityData.FAC_EPA_REGION || null,
      FAC_LAT: facilityData.FAC_LAT || facilityData.Latitude || null,
      FAC_LONG: facilityData.FAC_LONG || facilityData.Longitude || null,
      FAC_NAICS_CODES: facilityData.FAC_NAICS_CODES || facilityData.NAICS || null,
      FAC_SIC_CODES: facilityData.FAC_SIC_CODES || facilityData.SIC || null,
      FAC_COMPLIANCE_STATUS: facilityData.FAC_COMPLIANCE_STATUS || null,
      FAC_SNC_FLG: facilityData.FAC_SNC_FLG || null,
      FAC_QTRS_WITH_NC: facilityData.FAC_QTRS_WITH_NC || null,
      FAC_TOTAL_PENALTIES: facilityData.FAC_TOTAL_PENALTIES || null,
      FAC_INSPECTION_COUNT: facilityData.FAC_INSPECTION_COUNT || null,
      FAC_FORMAL_ACTION_COUNT: facilityData.FAC_FORMAL_ACTION_COUNT || null,
      FAC_INFORMAL_COUNT: facilityData.FAC_INFORMAL_COUNT || null,
      NPDES_FLAG: facilityData.NPDES_FLAG || null,
      RCRA_FLAG: facilityData.RCRA_FLAG || null,
      AIR_FLAG: facilityData.AIR_FLAG || null,
      TRI_FLAG: facilityData.TRI_FLAG || null,
      CWA_SNC_FLG: facilityData.CWA_SNC_FLG || null,
      CWA_QTRS_WITH_NC: facilityData.CWA_QTRS_WITH_NC || null,
      CWA_COMPLIANCE_STATUS: facilityData.CWA_COMPLIANCE_STATUS || null,
      NPDES_IDS: facilityData.NPDES_IDS || null,
      RCRA_IDS: facilityData.RCRA_IDS || null,
      AIR_IDS: facilityData.AIR_IDS || null,
      FAC_DATE_LAST_INSPECTION_EPA: facilityData.FAC_DATE_LAST_INSPECTION_EPA || null,
      FAC_DATE_LAST_INSPECTION_STATE: facilityData.FAC_DATE_LAST_INSPECTION_STATE || null,
      FAC_DATE_LAST_FORMAL_ACT_EPA: facilityData.FAC_DATE_LAST_FORMAL_ACT_EPA || null,
      FAC_DATE_LAST_INFORMAL_ACT_EPA: facilityData.FAC_DATE_LAST_INFORMAL_ACT_EPA || null,
      CWA_PENALTIES: facilityData.CWA_PENALTIES || null,
      RCRA_PENALTIES: facilityData.RCRA_PENALTIES || null,
      CAA_PENALTIES: facilityData.CAA_PENALTIES || null,
      DFR_URL: facilityData.DFR_URL || `http://echo.epa.gov/detailed-facility-report?fid=${facilityData.REGISTRY_ID}`,
    };
  }

  /**
   * Calculate aggregated data with additional fields
   */
  calculateAggregatedData(facilityData, violations, inspections) {
    const lastInspectionEPA = this.getValue(facilityData, ['FAC_DATE_LAST_INSPECTION_EPA', 'fac_date_last_inspection_epa']);
    const lastFormalActionEPA = this.getValue(facilityData, ['FAC_DATE_LAST_FORMAL_ACT_EPA', 'fac_date_last_formal_act_epa']);
    
    // Calculate days since last inspection
    let daysSinceLastInspection = null;
    if (lastInspectionEPA) {
      const lastInspectionDate = new Date(lastInspectionEPA);
      const today = new Date();
      daysSinceLastInspection = Math.floor((today - lastInspectionDate) / (1000 * 60 * 60 * 24));
    }

    // Calculate days since last formal action
    let daysSinceLastFormalAction = null;
    if (lastFormalActionEPA) {
      const lastFormalActionDate = new Date(lastFormalActionEPA);
      const today = new Date();
      daysSinceLastFormalAction = Math.floor((today - lastFormalActionDate) / (1000 * 60 * 60 * 24));
    }

    // Count programs with SNC
    let programsWithSNC = 0;
    if (this.getValue(facilityData, ['CWA_SNC_FLG', 'cwa_snc_flg']) === 'Y') programsWithSNC++;
    if (this.getValue(facilityData, ['CAA_SNC_FLG', 'caa_snc_flg']) === 'Y') programsWithSNC++;
    if (this.getValue(facilityData, ['RCRA_SNC_FLG', 'rcra_snc_flg']) === 'Y') programsWithSNC++;

    return {
      totalPenalties: parseFloat(this.getValue(facilityData, ['FAC_TOTAL_PENALTIES', 'fac_total_penalties', 'totalPenalties', 'total_penalties']) || 0),
      formalActionCount: parseInt(this.getValue(facilityData, ['FAC_FORMAL_ACTION_COUNT', 'fac_formal_action_count', 'formalActionCount', 'formal_action_count']) || 0),
      informalCount: parseInt(this.getValue(facilityData, ['FAC_INFORMAL_COUNT', 'fac_informal_count', 'informalCount', 'informal_count']) || 0),
      inspectionCount: parseInt(this.getValue(facilityData, ['FAC_INSPECTION_COUNT', 'fac_inspection_count', 'inspectionCount', 'inspection_count']) || 0),
      quartersWithNC: parseInt(this.getValue(facilityData, ['FAC_QTRS_WITH_NC', 'fac_qtrs_with_nc', 'QTRS_WITH_NC', 'qtrs_with_nc', 'quartersWithNC', 'quarters_with_nc']) || 0),
      programsWithSNC: programsWithSNC,
      daysSinceLastInspection: daysSinceLastInspection,
      daysSinceLastFormalAction: daysSinceLastFormalAction,
    };
  }

  /**
   * Get comprehensive facility details by REGISTRY_ID
   * Returns structured data matching the exact format provided
   */
  async getFacilityDetails(req, res) {
    try {
      const { id } = req.params; // REGISTRY_ID
      const cleanId = id.trim();
      console.log(`[DEBUG] Getting comprehensive details for REGISTRY_ID: ${cleanId}`);
      // Get Facility model (summary) and related collections (violations, inspections, emissions, enforcements)
      let Facility;
      let collections;
      try {
        Facility = await this.getFacilityModel();
        collections = await this.getCollections();
      } catch (error) {
        console.error(`[ERROR] Database connection/query error:`, error);
        return res.status(500).json({
          success: false,
          error: `Failed to connect to dump database: ${error.message}`,
        });
      }

      if (!Facility || !collections) {
        return res.status(500).json({
          success: false,
          error: 'Required database models/collections are not available.',
        });
      }

      // Fetch facility summary from facilities collection
      // IMPORTANT: do NOT query by _id here to avoid ObjectId cast errors for non-ObjectId strings.
      const searchQueries = [
        { REGISTRY_ID: cleanId },
        { REGISTRY_ID: cleanId.toString() },
      ];

      console.log(`[DEBUG] Searching facilities collection for REGISTRY_ID: ${cleanId}`);
      console.log(`[DEBUG] Trying ${searchQueries.length} query variations`);

      let facilityDoc = await Facility.findOne({ $or: searchQueries }).lean();

      if (!facilityDoc) {
        return res.status(404).json({
          success: false,
          error: `No facility found with REGISTRY_ID: ${cleanId}`,
        });
      }

      const registryId = String(facilityDoc.REGISTRY_ID || facilityDoc._id || cleanId);

      // Build facility object for response (keep same shape as before as much as possible)
      const {
        id: _removeId,
        epaId: _removeEpaId,
        facilityName: _removeFacilityName,
        ...cleanFacility
      } = facilityDoc;

      const facility = {
        ...cleanFacility,
      };

      // Join related data from separate collections
      const [violations, inspections, emissions, enforcementCases] = await Promise.all([
        collections.violations.find({ facilityId: registryId }).toArray(),
        collections.inspections.find({ facilityId: registryId }).toArray(),
        collections.emissions.find({ facilityId: registryId }).toArray(),
        collections.enforcements.find({ facilityId: registryId }).toArray(),
      ]);

      const complianceScores = facilityDoc.complianceScores || {};

      // Build response with joined data; keep field names the same
      const formattedResponse = {
        facility,
        violations,
        inspections,
        enforcementCases,
        complianceScores,
        emissions,
      };

      res.json(formattedResponse);
    } catch (error) {
      console.error(`[ERROR] Error in getFacilityDetails:`, error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Calculate compliance score (0-10 scale)
   */
  calculateComplianceScore(facilityData, type) {
    let score = 10; // Start with perfect score

    // Deduct points for violations
    const violationCount = parseFloat(this.getValue(facilityData, [
      'violationCount', 'violation_count', 'QTRS_WITH_NC', 'qtrs_with_nc'
    ]) || 0);
    score -= violationCount * 0.5;

    // Deduct for non-compliance
    const complianceStatus = String(this.getValue(facilityData, [
      'FAC_COMPLIANCE_STATUS', 'fac_compliance_status', 'complianceStatus', 'compliance_status'
    ]) || '').toLowerCase();
    if (complianceStatus.includes('noncompliant') || complianceStatus.includes('snc')) {
      score -= 3;
    }

    // Deduct for penalties
    const penalties = parseFloat(this.getValue(facilityData, [
      'FAC_TOTAL_PENALTIES', 'fac_total_penalties', 'totalPenalties', 'total_penalties'
    ]) || 0);
    if (penalties > 0) {
      score -= Math.min(2, penalties / 50000); // Max 2 point deduction
    }

    return parseFloat(Math.max(0, Math.min(10, score)).toFixed(1));
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

