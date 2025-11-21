const mongoose = require('mongoose');

// This will be set when dump connection is established
let dumpConnection = null;

const FacilitySchema = new mongoose.Schema({
  // Facility identification
  FRS_ID: String,
  FacilityName: String,
  City: String,
  State: String,
  Zip: String,
  County: String,
  
  // Location coordinates
  Latitude: Number,
  Longitude: Number,
  
  // Codes
  SIC: String,
  NAICS: String,
  
  // Additional facility data (flexible schema)
  facilityData: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  
  // Source information
  source: {
    type: {
      type: String, // 'cwa', 'air', 'rcra', etc.
    },
    folder: String,
    fetchedAt: Date,
    queryParams: mongoose.Schema.Types.Mixed,
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
  collection: 'facilities', // Explicit collection name
});

// Indexes for efficient queries
FacilitySchema.index({ FRS_ID: 1 });
FacilitySchema.index({ State: 1 });
FacilitySchema.index({ City: 1 });
FacilitySchema.index({ Zip: 1 });
FacilitySchema.index({ SIC: 1 });
FacilitySchema.index({ NAICS: 1 });
FacilitySchema.index({ FacilityName: 'text' }); // Text search index
FacilitySchema.index({ 'source.type': 1 });

FacilitySchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Export schema and function to create model with connection
module.exports = {
  schema: FacilitySchema,
  createModel: (connection) => {
    if (!connection) {
      return mongoose.model('Facility', FacilitySchema);
    }
    return connection.model('Facility', FacilitySchema);
  },
  getModel: () => {
    return mongoose.models.Facility || mongoose.model('Facility', FacilitySchema);
  },
};

