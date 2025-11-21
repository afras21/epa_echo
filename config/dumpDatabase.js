const mongoose = require('mongoose');
require('dotenv').config();

const connectDumpDB = async () => {
  try {
    let mongoUri = process.env.MONGODB_DUMP_URI;
    
    if (!mongoUri) {
      throw new Error('MONGODB_DUMP_URI is not set in environment variables');
    }
    
    const dbName = 'epaDump';
    
    // Ensure database name is in the connection string
    // If URI doesn't end with a database name, add it
    const hasDbName = mongoUri.match(/\/[^\/\?]+(\?|$)/);
    if (!hasDbName) {
      // Remove trailing slash if present
      mongoUri = mongoUri.replace(/\/$/, '');
      // Add database name
      if (mongoUri.includes('?')) {
        mongoUri = mongoUri.replace('?', `/${dbName}?`);
      } else {
        mongoUri = `${mongoUri}/${dbName}`;
      }
    } else {
      // Check if the database name is already epaDump, if not replace it
      const currentDbName = mongoUri.match(/\/([^\/\?]+)(\?|$)/)?.[1];
      if (currentDbName && currentDbName !== dbName) {
        mongoUri = mongoUri.replace(`/${currentDbName}`, `/${dbName}`);
      }
    }
    
    console.log(`\n[CONNECTING] Attempting to connect to dump database...`);
    console.log(`  Connection String: ${mongoUri.replace(/:[^:@]+@/, ':****@')}`);
    
    const conn = mongoose.createConnection(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // 30 seconds
      socketTimeoutMS: 45000, // 45 seconds
      connectTimeoutMS: 30000, // 30 seconds
    });
    
    // Wait for connection to be ready
    await new Promise((resolve, reject) => {
      if (conn.readyState === 1) {
        // Already connected
        resolve();
        return;
      }
      
      const timeout = setTimeout(() => {
        conn.close();
        reject(new Error(`Connection timeout after 30 seconds. Please check:
1. MONGODB_DUMP_URI is correct: ${mongoUri.replace(/:[^:@]+@/, ':****@')}
2. Network connectivity to MongoDB
3. MongoDB cluster is accessible
4. Database name is correct: epaDump`));
      }, 30000); // 30 second timeout
      
      conn.once('connected', () => {
        clearTimeout(timeout);
        resolve();
      });
      
      conn.once('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Connection error: ${err.message}. Please check your MONGODB_DUMP_URI.`));
      });
      
      // Also handle 'open' event as fallback
      conn.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    
    // Create Facility model on this connection
    const FacilityModule = require('../models/Facility');
    const Facility = FacilityModule.createModel(conn);
    
    const collectionName = 'facilities';
    
    // Get actual database name from connection
    const actualDbName = conn.db ? conn.db.databaseName : dbName;
    const host = conn.host || 'unknown';
    
    console.log(`\n✓ MongoDB Dump Database Connected Successfully`);
    console.log(`  Host: ${host}`);
    console.log(`  Database: ${actualDbName}`);
    console.log(`  Collection: ${collectionName}`);
    console.log(`  Connection String: ${mongoUri.replace(/:[^:@]+@/, ':****@')}\n`);
    
    // Store Facility model on connection for easy access
    conn.Facility = Facility;
    
    return conn;
  } catch (error) {
    console.error(`\n✗ MongoDB Dump Database Connection Failed`);
    console.error(`  Error: ${error.message}\n`);
    throw error;
  }
};

module.exports = connectDumpDB;

