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

Each facility item in the list view includes (subset):

- `_id`: Registry ID (FRS ID)
- `name`: Facility name
- `address`, `street`, `city`, `state`, `zip`, `county`, `region`
- `industryGroup`
- `lat`, `long`
- `programs`: Array of program codes/descriptions (e.g., CAA, CWA/NPDES, RCRA)
- `complianceStatus`
- `riskScoreOverall`
- `violationsCount`
- `lastInspectionDate`

### Get Facility by ID
```
GET /api/facilities/:id
```

Returns a specific facility by FRS ID or facility name.

### Get Comprehensive Facility Details
```
GET /api/facilities/:id/details
```

Returns a comprehensive detail object for a facility, joined from multiple collections:

- `facility`: Flattened facility summary (matching the `facilities` collection shape)
- `violations`: All related violations for the facility
- `inspections`: All related inspections
- `enforcementCases`: All related enforcement cases
- `complianceScores`: Precomputed or recalculated compliance scores
- `emissions`: Emissions records (if present)

Example facility summary document (from `facilities` collection):

```json
{
  "_id": "110070466233",
  "REGISTRY_ID": "110070466233",
  "id": "110070466233",
  "name": "ACME CHEMICAL PLANT",
  "facilityName": "ACME CHEMICAL PLANT",
  "address": "123 INDUSTRIAL WAY",
  "street": "123 INDUSTRIAL WAY",
  "city": "RIVER TOWN",
  "state": "TX",
  "zip": "75001",
  "county": "DALLAS",
  "region": "06",
  "industryGroup": "Chemical Manufacturing",
  "latitude": 32.9567,
  "longitude": -96.8353,
  "naicsCode": "325199",
  "sicCode": "2819",
  "programs": [
    { "code": "NPDES", "programDesc": "National Pollutant Discharge Elimination System" },
    { "code": "CAA", "programDesc": "Clean Air Act" },
    { "code": "RCRA", "programDesc": "Resource Conservation and Recovery Act" }
  ],
  "complianceStatus": "In Violation",
  "lastInspection": "2024-07-15",
  "lastInspectionType": "EPA",
  "inspectionDates": {
    "epa": "2024-07-15",
    "state": "2023-11-02",
    "mostRecent": { "date": "2024-07-15", "type": "EPA" }
  },
  "enforcementActions": {
    "lastFormalActionEPA": "2023-12-20",
    "lastFormalActionState": "2022-08-10",
    "lastInformalActionEPA": "2023-05-01",
    "lastInformalActionState": "2023-03-15"
  },
  "aggregatedData": {
    "totalPenalties": 250000.0,
    "formalActionCount": 3,
    "informalCount": 5,
    "inspectionCount": 12,
    "quartersWithNC": 6
  },
  "riskScore": 4.2,
  "complianceScores": {
    "overall": 5.0,
    "air": 6.5,
    "water": 4.0,
    "waste": 5.5
  },
  "violationCount": 18,
  "inspectionCount": 12,
  "emissionCount": 45,
  "enforcementCaseCount": 2
}
```

Related collections (examples):

- **Violations**

  ```json
  {
    "_id": "VIO-110070466233-001",
    "facilityId": "110070466233",
    "program": "NPDES",
    "violationType": "Effluent Limit Exceedance",
    "type": "Effluent Limit Exceedance",
    "description": "Exceeded monthly average limit for BOD",
    "date": "2024-06-01",
    "severity": "Significant",
    "status": "Open",
    "penalty": 15000.0,
    "resolved": false,
    "finding": "Significant Non-Compliance (SNC)"
  }
  ```

- **Inspections**

  ```json
  {
    "_id": "INS-110070466233-001",
    "facilityId": "110070466233",
    "date": "2024-07-15",
    "type": "Compliance Evaluation Inspection",
    "program": "NPDES",
    "findings": "In Violation",
    "violations": 4,
    "result": "In Violation",
    "inspector": "EPA Region 6",
    "summary": "Compliance Evaluation Inspection conducted. Compliance status: In Violation"
  }
  ```

- **Emissions**

  ```json
  {
    "_id": "EM-110070466233-001",
    "facilityId": "110070466233",
    "year": "2023",
    "pollutant": "Nitrogen Oxides (NOx)",
    "program": "TRI",
    "quantityTons": 120.5,
    "unit": "tons/year",
    "stackId": "STK-1",
    "processDescription": "Boiler #1"
  }
  ```

- **Enforcement Cases**

  ```json
  {
    "_id": "ENF-110070466233-12345",
    "facilityId": "110070466233",
    "case_number": "12345",
    "case_name": "ACME CHEMICAL – NPDES Violations",
    "status": "Closed",
    "fiscal_year": "2024",
    "penalties": {
      "total": 200000.0,
      "federal": 150000.0,
      "stateLocal": 50000.0
    },
    "violations": [
      "Effluent Limit Exceedance",
      "Failure to Report DMRs"
    ],
    "milestones": [
      { "type": "Complaint Filed", "date": "2023-09-01" },
      { "type": "Consent Decree Lodged", "date": "2024-01-15" },
      { "type": "Final Order", "date": "2024-03-30" }
    ]
  }
  ```

### Facility Statistics (Dashboard)
```
GET /api/facilities/statistics
```

Returns dashboard statistics JSON with:

- Total facilities, compliant, non-compliant, under review, high-risk
- Active violations
- Program counts (`air`, `water`, `waste`, `enforcements`)
- `topRecentSearches`, `topHighRiskFacilities`, `latestInspections`

Currently this endpoint serves a default, precomputed statistics payload.

### Enforcement Analytics Report
```
GET /api/facilities/enforcement-report
```

Returns enforcement analytics data from the `enforcementSummary` collection. Supports optional `year` filter:

- `GET /api/facilities/enforcement-report` – all years
- `GET /api/facilities/enforcement-report?year=2023` – only records for 2023

Response format:

```json
{
  "success": true,
  "updatedAt": "2025-01-01T00:00:00.000Z",
  "data": [
    {
      "_id": "...",
      "year": 2023,
      "media": "CAA",
      "region": "Region 5",
      "industry": "Manufacturing",
      "cases": 120,
      "totalPenalties": 4500000,
      "avgPenalty": 37500,
      "trend": "up",
      "notes": "Precomputed enforcement summary data for this segment"
    }
  ]
}
```

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
