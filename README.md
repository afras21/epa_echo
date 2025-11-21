# EPA Facilities API Server

A Node.js API server that provides access to EPA facilities data stored in MongoDB. The server reads from a MongoDB dump database and provides RESTful endpoints to query facilities with filtering and pagination.

## Features

- 🔍 Query facilities from MongoDB dump database
- 📍 Filter by location (state, city, ZIP)
- 🔢 Filter by codes (SIC, NAICS, FRS ID)
- 📄 Cursor-based pagination with nextToken
- 🚀 Fast and efficient queries

## Prerequisites

- Node.js (v14 or higher)
- MongoDB (with dump database containing facilities)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file in the root directory:
```env
MONGODB_DUMP_URI=mongodb+srv://username:password@cluster.mongodb.net/
PORT=3000
```

**Note**: The connection string should connect to a MongoDB instance with:
- Database: `epaDump`
- Collection: `facilities`

3. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

## Configuration

### Environment Variables

- `MONGODB_DUMP_URI`: MongoDB connection string for facilities dump database (required)
  - Database: `epaDump`
  - Collection: `facilities`
- `PORT`: Server port (default: 3000)

## API Endpoints

### Health Check
```
GET /health
```

### List All Facilities
```
GET /api/facilities?state=CA&city=Los Angeles&limit=50&nextToken=...
```

**Query Parameters:**
- `state` - Filter by state code (e.g., CA, NY, TX)
- `city` - Filter by city name (partial match)
- `zip` - Filter by ZIP code
- `sic` - Filter by SIC code
- `naics` - Filter by NAICS code
- `frsId` - Filter by FRS ID
- `name` - Filter by facility name (partial match)
- `type` - Filter by API type: `cwa`, `air`, or `rcra`
- `limit` - Number of results per page (default: 50, max: 500)
- `nextToken` - Token for pagination (from previous response)

**Response includes:**
- `data` - Array of facilities
- `pagination.nextToken` - Token for next page (null if no more results)
- `pagination.total` - Total number of facilities matching filters
- `pagination.hasMore` - Boolean indicating if more results available

### Get Facility by ID
```
GET /api/facilities/:id
```

Returns a specific facility by FRS ID or facility name.

## Usage Examples

### Get all facilities (first page):
```bash
curl "http://localhost:3000/api/facilities?limit=50"
```

### Filter by state:
```bash
curl "http://localhost:3000/api/facilities?state=CA&limit=50"
```

### Filter by city and state:
```bash
curl "http://localhost:3000/api/facilities?state=CA&city=Los%20Angeles&limit=50"
```

### Filter by ZIP code:
```bash
curl "http://localhost:3000/api/facilities?zip=90210"
```

### Filter by facility type:
```bash
curl "http://localhost:3000/api/facilities?type=cwa&limit=50"
```

### Pagination - use nextToken from previous response:
```bash
curl "http://localhost:3000/api/facilities?limit=50&nextToken=eyJpZCI6IjY1...=="
```

### Get facility by ID:
```bash
curl "http://localhost:3000/api/facilities/110000123456"
```

## Response Format

```json
{
  "success": true,
  "data": [
    {
      "FRS_ID": "110000123456",
      "FacilityName": "Example Facility",
      "City": "Los Angeles",
      "State": "CA",
      "Zip": "90210",
      "SIC": "2911",
      "NAICS": "221310",
      "facilityData": { ... },
      "source": {
        "type": "cwa",
        "folder": "Water (CWA) - Facility Info",
        "fetchedAt": "2024-01-01T00:00:00.000Z"
      }
    }
  ],
  "pagination": {
    "limit": 50,
    "count": 50,
    "total": 1250,
    "hasMore": true,
    "nextToken": "eyJpZCI6IjY1..."
  },
  "filters": {
    "state": "CA",
    "city": "Los Angeles"
  }
}
```

## Project Structure

```
epa_echo_server/
├── config/
│   └── dumpDatabase.js    # MongoDB dump database connection
├── controllers/
│   └── facilityController.js  # Facility query logic
├── models/
│   └── Facility.js        # Facility MongoDB schema
├── routes/
│   └── facilities.js      # Facility API routes
├── server.js              # Main server file
├── package.json
└── README.md
```

## Deployment

### Option 1: Deploy to Railway (Recommended - No Payment Info Required)

1. **Push your code to GitHub** (if not already):
   ```bash
   git add .
   git commit -m "Ready for deployment"
   git push
   ```

2. **Go to [Railway.app](https://railway.app)** and sign up/login with GitHub

3. **Create New Project**:
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose your repository

4. **Add Environment Variable**:
   - Click on your project → Variables
   - Add: `MONGODB_DUMP_URI` = `mongodb+srv://username:password@cluster.mongodb.net/epaDump`

5. **Deploy**:
   - Railway auto-detects Node.js and deploys automatically
   - Your API will be live at: `https://your-app-name.up.railway.app`

6. **Test**:
   ```bash
   curl https://your-app-name.up.railway.app/health
   curl https://your-app-name.up.railway.app/api/facilities?limit=10
   ```

**Railway Benefits:**
- ✅ No payment info required for free tier
- ✅ $5 free credit monthly
- ✅ Auto-detects Node.js
- ✅ Automatic HTTPS

### Option 2: Deploy to Render (Requires Payment Info for Verification)

1. **Push your code to GitHub**

2. **Go to [Render Dashboard](https://dashboard.render.com)** and sign up/login

3. **Create a New Web Service**:
   - Click "New" → "Web Service"
   - Connect your GitHub repository
   - Select your repository

4. **Configure**:
   - **Name**: `epa-facilities-api`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Select **"Free"**
   - **Note**: Render requires payment info for verification (you won't be charged on free plan)

5. **Add Environment Variable**:
   - Click "Environment" tab
   - Add: `MONGODB_DUMP_URI` = your connection string

6. **Deploy** and test your API

## License

ISC
