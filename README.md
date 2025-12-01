# Compass OCR Microservice

OCR microservice for processing passport, flight, and hotel tickets. This service receives documents from the main backend, performs OCR extraction, and sends results back via webhooks and Redis pub/sub.

## Features

- **Passport OCR**: Uses Gridlines API to extract passport information (name, passport number, DOB, expiry date, etc.)
- **Flight Ticket OCR**: Uses Tesseract.js to extract flight details (PNR, passenger name, flight number, dates, airports, times)
- **Hotel Ticket OCR**: Uses Tesseract.js to extract hotel booking information (hotel name, confirmation code, check-in/out dates, place)
- **Smart Mapping**: Automatically maps flight/hotel tickets to passengers using fuzzy name matching
- **Real-time Updates**: Publishes progress updates via Redis Pub/Sub for SSE streaming
- **Pre-signed URL Support**: Downloads files from pre-signed S3 URLs (no AWS credentials needed in OCR service)

## Prerequisites

- Node.js (v18 or higher)
- Redis server (for pub/sub)
- Gridlines API credentials (for passport OCR)
- Main backend running (for webhook callbacks)

**Note:** OCR service does NOT need AWS S3 credentials. It receives pre-signed URLs from the main backend.

## Setup Instructions

### 1. Install Dependencies

```bash
npm install
```

### 2. Environment Configuration

Create a `.env` file in the root directory:

```env
# Server
PORT=8001
NODE_ENV=development

# Gridlines API (for passport OCR)
GRIDLINES_API_KEY=your_gridlines_api_key
GRIDLINES_AUTH_TYPE=your_auth_type

# Redis (for pub/sub)
REDIS_URL=redis://localhost:6379
OCR_PROGRESS_CHANNEL=ocr_progress

# Main Backend (for webhook callbacks)
MAIN_BACKEND_URL=http://localhost:3000

# Logger
LOGGER_LEVEL=debug
LOGGER_ERROR_FILE=logs/error.log
LOGGER_COMBINED_FILE=logs/combined.log
LOGGER_ENABLE_CONSOLE=true
LOGGER_SERVICE_NAME=compass-ocr-service
```

### 3. Run the Service

**Development:**
```bash
npm run dev
```

**Production:**
```bash
npm run build
npm start
```

The service will start on `http://localhost:8001` (or the port specified in `.env`).

## API Endpoints

### POST /process/documents

Process documents for OCR. Receives pre-signed URLs from main backend.

**Request:**
```json
{
  "order_id": "e1c95ccf-5f10-4946-a85c-12de9fe1e3ab",
  "documents": [
    {
      "traveller_id": "uuid",
      "traveller_name": "John Doe",
      "document_id": "uuid",
      "file_url": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
      "document_type": "passport_front"
    },
    {
      "traveller_id": "uuid",
      "traveller_name": "John Doe",
      "document_id": "uuid",
      "file_url": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
      "document_type": "passport_back"
    },
    {
      "traveller_id": "uuid",
      "traveller_name": "John Doe",
      "document_id": "uuid",
      "file_url": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
      "document_type": "flight"
    },
    {
      "traveller_id": "uuid",
      "traveller_name": "John Doe",
      "document_id": "uuid",
      "file_url": "https://bucket.s3.amazonaws.com/...?X-Amz-Signature=...",
      "document_type": "hotel"
    }
  ]
}
```

**Response:**
```json
{
  "status": "accepted",
  "message": "Documents are being processed",
  "order_id": "e1c95ccf-5f10-4946-a85c-12de9fe1e3ab"
}
```

**Note:** Processing happens asynchronously. Progress updates are published to Redis channel `ocr_progress:{order_id}`.

### GET /health

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "service": "compass-ocr-service"
}
```

## Architecture

### Flow

1. **Main Backend** uploads passport/hotel/flight documents to S3
2. **Main Backend** generates pre-signed URLs and sends to OCR service
3. **OCR Service** downloads files from pre-signed URLs
4. **OCR Service** processes OCR:
   - Passport: Calls Gridlines API
   - Flight/Hotel: Uses Tesseract.js
5. **OCR Service** publishes progress to Redis: `ocr_progress:{order_id}`
6. **OCR Service** updates main backend via webhook: `POST /order/{order_id}/ocr-results`
7. **Main Backend** SSE endpoint forwards Redis messages to frontend

### Redis Pub/Sub

- **Channel Pattern**: `ocr_progress:{order_id}`
- **Message Format**:
```json
{
  "order_id": "uuid",
  "traveller_id": "uuid",
  "traveller_name": "John Doe",
  "document_id": "uuid",
  "document_type": "passport" | "flight" | "hotel",
  "status": "processing" | "mapped" | "failed",
  "extracted_data": { ... },
  "error": "error message (if failed)",
  "timestamp": "2025-01-01T12:00:00Z"
}
```

## Document Types

### Passport (`passport_front` + `passport_back`)

**Processing:**
- Requires both front and back images
- Calls Gridlines API with both images
- Extracts: full_name, passport_number, date_of_birth, expiry_date, nationality, etc.

**Extracted Data:**
```json
{
  "full_name": "John Doe",
  "passport_number": "A12345678",
  "date_of_birth": "1990-01-15",
  "expiry_date": "2030-01-15",
  "nationality": "US",
  "place_of_birth": "New York",
  "gender": "M"
}
```

### Flight Ticket (`flight`)

**Processing:**
- Uses Tesseract.js OCR
- Validates ticket by checking for flight-related keywords
- Maps to passenger using fuzzy name matching

**Extracted Data:**
```json
{
  "pnr": "SISCPF",
  "passenger_name": "Mahendra Patel",
  "flight_number": "6E1402",
  "departure_date": "21 Apr 2025",
  "departure_time": "06:20 hrs",
  "arrival_date": "23 Apr 2025",
  "arrival_time": "21:55 hrs",
  "from": "BOM - Chhatrapati Shivaji Maharaj International Airport",
  "to": "AUH - Abu Dhabi International Airport",
  "departure_airport": "BOM",
  "arrival_airport": "AUH",
  "airline": "6E"
}
```

### Hotel Booking (`hotel`)

**Processing:**
- Uses Tesseract.js OCR
- Validates booking by checking for hotel-related keywords
- Maps to passenger using fuzzy name matching

**Extracted Data:**
```json
{
  "hotel_name": "6 Bedroom Villa. Dubai Hills",
  "confirmation_code": "HMKNRM4JDD",
  "booking_reference": "HMKNRM4JDD",
  "check_in_date": "Mon, Apr 21",
  "check_in_time": "3:00PM",
  "check_out_date": "Wed, Apr 23",
  "check_out_time": "11:00AM",
  "place": "Dubal Hills Maple 3, 3.5, 3s, Unlted Arab Emirates",
  "address": "Dubal Hills Maple 3, 3.5, 3s, Unlted Arab Emirates",
  "guest_name": "Rashi Patel"
}
```

## Webhook Callback

After processing, OCR service calls main backend:

**POST** `{MAIN_BACKEND_URL}/order/{order_id}/ocr-results`

**Request Body:**
```json
{
  "traveller_id": "uuid",
  "ticket_type": "passport" | "flight" | "hotel",
  "passport_front_doc_id": "uuid", // For passport
  "passport_back_doc_id": "uuid", // For passport
  "document_id": "uuid", // For flight/hotel
  "ocr_status": "COMPLETED" | "FAILED",
  "ocr_extracted_data": { ... },
  "mapped_to_traveller_id": "uuid" // For flight/hotel
}
```

## Project Structure

```
compass-ocr-service/
├── src/
│   ├── api/
│   │   └── process/
│   │       └── process.router.ts    # POST /process/documents
│   ├── services/
│   │   ├── passport.service.ts      # Gridlines API integration
│   │   ├── flight.service.ts        # Flight ticket OCR
│   │   ├── hotel.service.ts         # Hotel booking OCR
│   │   └── mapping.service.ts       # Map tickets to passengers
│   ├── config/
│   │   ├── env.ts                   # Environment configuration
│   │   └── redis.ts                 # Redis pub/sub
│   └── utils/
│       └── logger.ts                # Winston logger
├── index.ts                         # Application entry point
├── package.json
├── tsconfig.json
└── .env
```

## Development

### Running in Development

```bash
npm run dev
```

### Building for Production

```bash
npm run build
npm start
```

### Logs

Logs are written to:
- `logs/combined.log` - All logs
- `logs/error.log` - Error logs only

## Error Handling

- **Passport OCR Failure**: Status set to `FAILED`, error message in `ocr_extracted_data`
- **Flight/Hotel OCR Failure**: Status set to `FAILED`, error message in `ocr_extracted_data`
- **Invalid Document**: Status set to `invalid`, document skipped
- **Network Errors**: Retries with exponential backoff (if implemented)

## Performance

- **Passport OCR**: ~2-5 seconds per passport (Gridlines API)
- **Flight OCR**: ~3-8 seconds per ticket (Tesseract.js)
- **Hotel OCR**: ~3-8 seconds per booking (Tesseract.js)
- **Parallel Processing**: Multiple documents processed concurrently

## Security

- **No AWS Credentials Required**: OCR service uses pre-signed URLs from main backend (no S3 credentials needed)
- **Temporary URLs**: Pre-signed URLs expire after 1 hour
- **No File Storage**: Files are downloaded, processed, and discarded immediately
- **Environment Variables**: Sensitive data (Gridlines API keys) stored in `.env` (not committed)

## Troubleshooting

### Gridlines API 404 Errors

- Check `GRIDLINES_API_KEY` and `GRIDLINES_AUTH_TYPE` are set correctly
- Verify API endpoint: `https://api.gridlines.io/passport-api/ocr`
- Check request format matches Gridlines API documentation

### Redis Connection Issues

- Verify Redis is running: `redis-cli ping`
- Check `REDIS_URL` in `.env`
- Ensure Redis server is accessible from OCR service

### OCR Extraction Issues

- Check Tesseract.js language data is installed (`eng.traineddata`)
- Verify image quality (higher resolution = better extraction)
- Review `raw_text` in results to debug extraction patterns

### Webhook Callback Failures

- Verify `MAIN_BACKEND_URL` is correct
- Check main backend is running and accessible
- Review logs for HTTP error responses

## License

ISC
