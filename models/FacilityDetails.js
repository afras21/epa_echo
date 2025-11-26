const mongoose = require('mongoose');

const FacilityDetailsSchema = new mongoose.Schema({
  REGISTRY_ID: {
    type: String,
    required: true,
    index: true,
    unique: true,
  },
  
  // Icon base URL
  iconBaseURL: {
    type: String,
    default: 'https://echo.epa.gov/themes/custom/echo/images/map/',
  },
  
  // CWA (Water) - NPDES data
  cwa: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    violations: mongoose.Schema.Types.Mixed,
    inspections: mongoose.Schema.Types.Mixed,
    enforcement: mongoose.Schema.Types.Mixed,
    effluentChart: mongoose.Schema.Types.Mixed,
    permit: mongoose.Schema.Types.Mixed,
  },
  
  // CAA (Air) data
  caa: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    violations: mongoose.Schema.Types.Mixed,
    inspections: mongoose.Schema.Types.Mixed,
    enforcement: mongoose.Schema.Types.Mixed,
    permitClassifications: mongoose.Schema.Types.Mixed,
    hpvFlags: mongoose.Schema.Types.Mixed,
    emissionCategories: mongoose.Schema.Types.Mixed,
    emissionUnitDetails: mongoose.Schema.Types.Mixed, // ICIS-Air
    pollutantReleases: mongoose.Schema.Types.Mixed,
    permits: mongoose.Schema.Types.Mixed, // Air permits with issue/expire dates and agency
  },
  
  // RCRA (Hazardous Waste) data
  rcra: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    violations: mongoose.Schema.Types.Mixed,
    inspections: mongoose.Schema.Types.Mixed,
    enforcement: mongoose.Schema.Types.Mixed,
    handlerDetails: mongoose.Schema.Types.Mixed,
    generatorCategory: mongoose.Schema.Types.Mixed,
    wasteCodes: mongoose.Schema.Types.Mixed,
  },
  
  // SDWA (Drinking Water) - SDWIS data
  sdwa: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    violations: mongoose.Schema.Types.Mixed,
    enforcement: mongoose.Schema.Types.Mixed,
  },
  
  // TRI (Toxics Release Inventory) data
  tri: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    triFacilityId: String,
  },
  
  // GHG (Greenhouse Gas) data
  ghg: {
    facilityInfo: mongoose.Schema.Types.Mixed,
    ghgId: String,
  },
  
  // EJScreen (Environmental Justice) data - comprehensive fields
  ejscreen: {
    // Core EJ indicators
    airToxics: mongoose.Schema.Types.Mixed,
    waterDischargeEJ: mongoose.Schema.Types.Mixed,
    climateRisk: mongoose.Schema.Types.Mixed,
    trafficProximity: mongoose.Schema.Types.Mixed,
    leadPaint: mongoose.Schema.Types.Mixed,
    superfundProximity: mongoose.Schema.Types.Mixed,
    // All other EJScreen fields (100+ fields)
    rawData: mongoose.Schema.Types.Mixed,
  },
  
  // DFR URL
  dfrUrl: String,
  
  // Metadata
  lastFetched: {
    type: Date,
    default: Date.now,
  },
  fetchStatus: {
    type: Map,
    of: String, // 'success', 'error', 'pending'
    default: {},
  },
  fetchErrors: {
    type: Map,
    of: String, // Error messages
    default: {},
  },
  
  // Timestamps
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
}, {
  collection: 'facilityDetails',
  strict: false,
});

// Indexes
FacilityDetailsSchema.index({ REGISTRY_ID: 1 });
FacilityDetailsSchema.index({ lastFetched: 1 });

FacilityDetailsSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Export schema and function to create model with connection
module.exports = {
  schema: FacilityDetailsSchema,
  createModel: (connection) => {
    if (!connection) {
      return mongoose.model('FacilityDetails', FacilityDetailsSchema);
    }
    return connection.model('FacilityDetails', FacilityDetailsSchema);
  },
  getModel: () => {
    return mongoose.models.FacilityDetails || mongoose.model('FacilityDetails', FacilityDetailsSchema);
  },
};

