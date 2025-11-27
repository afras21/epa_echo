const redis = require('redis');
require('dotenv').config();

let redisClient = null;

const connectRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  // Check if Redis URL is provided
  const redisUrl = process.env.REDIS_URL || process.env.REDIS_URI;
  if (!redisUrl) {
    console.log(`[REDIS] No REDIS_URL provided, Redis caching disabled`);
    return null;
  }

  try {
    console.log(`\n[REDIS] Connecting to Redis...`);
    console.log(`  URL: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);
    
    // Configure socket options based on URL protocol
    const socketOptions = {
      reconnectStrategy: (retries) => {
        if (retries > 3) {
          console.warn(`[REDIS] Max reconnection attempts reached, giving up`);
          return new Error('Max reconnection attempts reached');
        }
        return Math.min(retries * 100, 3000);
      },
      connectTimeout: 10000, // 10 second timeout for external connections
    };

    // Enable TLS for rediss:// URLs (SSL/TLS connections)
    if (redisUrl.startsWith('rediss://')) {
      socketOptions.tls = true;
      // Set rejectUnauthorized based on environment
      // Use 'false' for development/testing, 'true' for production with proper CA
      socketOptions.rejectUnauthorized = process.env.NODE_ENV === 'production' ? true : false;
    }

    redisClient = redis.createClient({
      url: redisUrl,
      socket: socketOptions,
    });

    redisClient.on('error', (err) => {
      // Handle different error types gracefully
      if (err.code === 'ECONNREFUSED') {
        console.warn(`[REDIS] Connection refused - Redis server may not be running`);
      } else if (err.code === 'ENOTFOUND') {
        console.warn(`[REDIS] DNS lookup failed - Check your REDIS_URL hostname`);
        console.warn(`[REDIS] Current URL: ${redisUrl.replace(/:[^:@]+@/, ':****@')}`);
        console.warn(`[REDIS] Make sure the hostname is correct and includes the full domain`);
      } else {
        console.warn(`[REDIS] Connection error: ${err.message}`);
      }
    });

    redisClient.on('connect', () => {
      console.log(`[REDIS] Connecting...`);
    });

    redisClient.on('ready', () => {
      console.log(`✓ Redis Connected Successfully\n`);
    });

    redisClient.on('end', () => {
      console.log(`[REDIS] Connection closed`);
    });

    // Connect with timeout
    await Promise.race([
      redisClient.connect(),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Connection timeout')), 5000)
      )
    ]);

    return redisClient;
  } catch (error) {
    console.warn(`\n⚠ Redis Connection Failed - Caching disabled`);
    console.warn(`  Error: ${error.message}`);
    
    // Provide helpful hints for common errors
    if (error.message.includes('ENOTFOUND') || error.message.includes('getaddrinfo')) {
      // Check if this looks like an internal Render Redis URL
      const isInternalRenderUrl = redisUrl.includes('red-') && !redisUrl.includes('.');
      
      if (isInternalRenderUrl) {
        console.warn(`\n  ℹ️  This appears to be an internal Render Redis URL`);
        console.warn(`     Internal Redis URLs only work within Render's network`);
        console.warn(`     This is expected when running locally`);
        console.warn(`     Redis caching will work automatically when deployed on Render`);
      } else {
        console.warn(`\n  💡 Troubleshooting:`);
        console.warn(`     - Check if your Redis URL includes the full domain name`);
        console.warn(`     - Example formats:`);
        console.warn(`       * redis://hostname.domain.com:6379`);
        console.warn(`       * rediss://hostname.domain.com:6380 (SSL/TLS)`);
        console.warn(`       * redis://:password@hostname.domain.com:6379`);
        console.warn(`     - If using a cloud provider, check their documentation for the correct URL format`);
      }
    }
    
    console.warn(`  Statistics will be calculated on-demand\n`);
    // Clean up failed connection
    if (redisClient) {
      try {
        await redisClient.quit();
      } catch (e) {
        // Ignore cleanup errors
      }
      redisClient = null;
    }
    // Return null if Redis is not available (graceful degradation)
    return null;
  }
};

const getRedisClient = () => {
  return redisClient;
};

const closeRedis = async () => {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
};

module.exports = {
  connectRedis,
  getRedisClient,
  closeRedis,
};

