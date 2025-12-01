import { createWorker } from 'tesseract.js';
import logger from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface FlightOCRResult {
  status: 'success' | 'error' | 'invalid';
  data?: {
    passenger_name?: string;
    flight_number?: string;
    pnr?: string;
    departure_date?: string;
    departure_time?: string;
    arrival_date?: string;
    arrival_time?: string;
    departure_airport?: string;
    arrival_airport?: string;
    from?: string;
    to?: string;
    airline?: string;
    [key: string]: any;
  };
  error?: string;
  raw_text?: string;
}

/**
 * Validate if extracted text is a valid flight ticket
 */
function validate_flight_ticket(text: string): boolean {
  const lower_text = text.toLowerCase();
  
  // Check for flight-related keywords
  const flight_keywords = [
    'pnr',
    'booking reference',
    'flight',
    'airline',
    'departure',
    'arrival',
    'passenger',
    'ticket',
    'boarding',
    'gate',
    'seat',
    'airport',
  ];

  const found_keywords = flight_keywords.filter(keyword => lower_text.includes(keyword));
  
  // Need at least 3 flight-related keywords to be considered valid
  return found_keywords.length >= 3;
}

/**
 * Extract flight information from OCR text with improved accuracy
 */
function extract_flight_data(text: string): FlightOCRResult['data'] {
  const data: FlightOCRResult['data'] = {};
  
  // Extract PNR/Booking Reference (6 alphanumeric characters, often after "PNR" or "Booking Reference")
  const pnr_patterns = [
    /(?:pnr|booking\s+reference)[:\s]*([A-Z0-9]{6})/i,
    /\b([A-Z0-9]{6})\b(?!\s*(?:hrs|hours|pm|am))/i, // 6 char code not followed by time
  ];
  
  for (const pattern of pnr_patterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[1].length === 6) {
      data.pnr = match[1].toUpperCase();
      break;
    }
  }

  // Extract passenger name - look for patterns like "Mr/Ms/Mrs Name" or "Passenger Information"
  const name_patterns = [
    /(?:Mr|Ms|Mrs|Miss|Dr)[\s\.]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /passenger\s+information[\s\n]+(?:[A-Z][a-z]+\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
    /(?:passenger|name)[:\s]+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i,
  ];
  
  for (const pattern of name_patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const name = match[1].trim();
      // Filter out common false positives
      const false_positives = ['Information', 'Booking Reference', 'Payment Status', 'Complete', 'Abu Dhabi', 'Mumbai', 'Travel Time'];
      if (!false_positives.some(fp => name.includes(fp))) {
        data.passenger_name = name;
        break;
      }
    }
  }
  
  // Fallback: Look for common name patterns (First Last) after "Passenger Information"
  if (!data.passenger_name) {
    const fallback_match = text.match(/passenger\s+information[\s\S]{0,100}?(?:Mr|Ms|Mrs|Miss|Dr)?[\s\.]*([A-Z][a-z]+\s+[A-Z][a-z]+)/i);
    if (fallback_match && fallback_match[1]) {
      data.passenger_name = fallback_match[1].trim();
    }
  }

  // Extract flight number (airline code + numbers, e.g., "6E 1402", "6E 1429")
  const flight_patterns = [
    /([A-Z]{2,3})\s*(\d{3,4})\b/i, // Matches "6E 1402" or "6E1429"
    /\b([A-Z]{2,3}\s?\d{3,4})\b/i,
  ];
  
  for (const pattern of flight_patterns) {
    const match = text.match(pattern);
    if (match) {
      const flight_num = match[0].replace(/\s/g, '').toUpperCase();
      // Filter out dates and times
      if (!flight_num.match(/^\d+$/) && flight_num.length >= 4) {
        data.flight_number = flight_num;
        break;
      }
    }
  }

  // Extract airline code (from flight number or standalone)
  if (data.flight_number) {
    const airline_match = data.flight_number.match(/^([A-Z]{2,3})/);
    if (airline_match) {
      data.airline = airline_match[1];
    }
  }

  // Extract dates (look for patterns like "21 Apr 2025", "23 Apr 2025")
  const date_patterns = [
    /(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})/gi,
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/g,
  ];
  
  const dates: string[] = [];
  for (const pattern of date_patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[0]) {
        dates.push(match[0]);
      }
    }
  }
  
  if (dates.length >= 1) {
    data.departure_date = dates[0];
  }
  if (dates.length >= 2) {
    data.arrival_date = dates[1];
  }

  // Extract times (look for patterns like "21:55 hrs", "02:30 hrs")
  const time_patterns = [
    /(\d{1,2}):(\d{2})\s*(?:hrs|hours|am|pm)?/gi,
  ];
  
  const times: string[] = [];
  for (const pattern of time_patterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      if (match[0]) {
        times.push(match[0].trim());
      }
    }
  }
  
  if (times.length >= 1) {
    data.departure_time = times[0];
  }
  if (times.length >= 2) {
    data.arrival_time = times[1];
  }

  // Extract airports - look for patterns like "BOM - Chhatrapati Shivaji Maharaj International Airport"
  const airport_patterns = [
    /([A-Z]{3})\s+-\s+([A-Za-z\s]+(?:Airport|International Airport))/i,
    /([A-Z]{3})\s+to\s+([A-Z]{3})/i,
    /([A-Z]{3})\s+-\s+([A-Za-z\s]+)/i,
  ];
  
  const airport_matches: Array<{code: string, name: string}> = [];
  for (const pattern of airport_patterns) {
    const matches = text.matchAll(new RegExp(pattern.source, 'gi'));
    for (const match of matches) {
      if (match[1] && match[2]) {
        airport_matches.push({
          code: match[1].toUpperCase(),
          name: match[2].trim()
        });
      }
    }
  }
  
  // First match is usually departure, second is arrival
  if (airport_matches.length >= 1) {
    data.departure_airport = airport_matches[0].code;
    data.from = airport_matches[0].name || airport_matches[0].code;
  }
  if (airport_matches.length >= 2) {
    data.arrival_airport = airport_matches[1].code;
    data.to = airport_matches[1].name || airport_matches[1].code;
  }
  
  // Fallback: Extract full airport names if codes not found
  if (!data.from || !data.to) {
    const airport_name_patterns = [
      /([A-Z][a-zA-Z\s]+(?:Airport|International Airport))/g,
    ];
    
    const airports: string[] = [];
    for (const pattern of airport_name_patterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        if (match[1] && !airports.includes(match[1])) {
          airports.push(match[1].trim());
        }
      }
    }
    
    if (airports.length >= 1 && !data.from) {
      data.from = airports[0];
    }
    if (airports.length >= 2 && !data.to) {
      data.to = airports[1];
    }
  }

  return data;
}

/**
 * Process flight ticket OCR
 */
export async function process_flight_ocr(file_url: string): Promise<FlightOCRResult> {
  try {
    // Download file from pre-signed URL
    logger.info(`Processing flight ticket: ${file_url.substring(0, 80)}...`);
    
    const response = await fetch(file_url);
    if (!response.ok) {
      throw new Error(`Failed to download flight ticket: ${response.status} ${response.statusText}`);
    }
    const file_buffer = Buffer.from(await response.arrayBuffer());

    // Initialize Tesseract worker with better config
    const worker = await createWorker('eng', 1, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          // Suppress verbose logging
        }
      },
    });
    
    try {
      // Perform OCR with better settings
      const { data: { text } } = await worker.recognize(file_buffer, {
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 :/-.,\n',
      });
      
      logger.info(`Flight OCR extracted ${text.length} characters`);

      // Validate if it's a flight ticket
      if (!validate_flight_ticket(text)) {
        logger.warn('Extracted text does not appear to be a valid flight ticket');
        return {
          status: 'invalid',
          error: 'Text does not contain flight ticket information',
          raw_text: text,
        };
      }

      // Extract flight data
      const extracted_data = extract_flight_data(text);

      // Ensure we have at least PNR or passenger name
      if (!extracted_data.pnr && !extracted_data.passenger_name) {
        logger.warn('Could not extract essential flight information');
      }

      return {
        status: 'success',
        data: extracted_data,
        raw_text: text,
      };
    } finally {
      await worker.terminate();
    }
  } catch (error) {
    logger.error('Flight OCR failed:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  process_flight_ocr,
};
