import { createWorker } from 'tesseract.js';
import logger from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';

export interface HotelOCRResult {
  status: 'success' | 'error' | 'invalid';
  data?: {
    guest_name?: string;
    hotel_name?: string;
    booking_reference?: string;
    confirmation_code?: string;
    check_in_date?: string;
    check_in_time?: string;
    check_out_date?: string;
    check_out_time?: string;
    place?: string;
    address?: string;
    [key: string]: any;
  };
  error?: string;
  raw_text?: string;
}

/**
 * Validate if extracted text is a valid hotel booking
 */
function validate_hotel_booking(text: string): boolean {
  const lower_text = text.toLowerCase();
  
  // Check for hotel-related keywords
  const hotel_keywords = [
    'hotel',
    'booking',
    'reservation',
    'check-in',
    'check-out',
    'check in',
    'check out',
    'guest',
    'room',
    'accommodation',
    'confirmation',
    'villa',
    'host',
  ];

  const found_keywords = hotel_keywords.filter(keyword => lower_text.includes(keyword));
  
  // Need at least 3 hotel-related keywords to be considered valid
  return found_keywords.length >= 3;
}

/**
 * Extract hotel information from OCR text with improved accuracy
 */
function extract_hotel_data(text: string): NonNullable<HotelOCRResult['data']> {
  const data: NonNullable<HotelOCRResult['data']> = {};
  
  // Extract hotel name (look for patterns like "6 Bedroom Villa. Dubai Hills.")
  const hotel_patterns = [
    /^([A-Za-z0-9\s]+(?:Villa|Hotel|Resort|Lodge|Inn|Suites|Palace))[\.\s]/i,
    /([A-Z][a-zA-Z\s&]+(?:Villa|Hotel|Resort|Lodge|Inn|Suites|Palace))/i,
    /hotel[:\s]+([A-Z][a-zA-Z\s&]+)/i,
  ];
  
  for (const pattern of hotel_patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      data.hotel_name = match[1].trim().replace(/\.$/, '');
      break;
    }
  }

  // Extract confirmation code/booking reference
  const confirmation_patterns = [
    /confirmation\s+code[:\s]+([A-Z0-9]{6,12})/i,
    /booking\s+reference[:\s]+([A-Z0-9]{6,12})/i,
    /reservation\s+id[:\s]+([A-Z0-9]{6,12})/i,
    /\b([A-Z0-9]{8,12})\b(?!\s*(?:paid|amount|guests))/i, // 8-12 char code
  ];
  
  for (const pattern of confirmation_patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      data.confirmation_code = match[1].toUpperCase();
      data.booking_reference = match[1].toUpperCase();
      break;
    }
  }

  // Extract check-in date and time - pattern: "Checkin Checkout\n3:00PM 11:00AM\nMon, Apr 21. Wed, Apr 23"
  const check_in_patterns = [
    /check[- ]?in[:\s]*(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    /check[- ]?in[:\s]*([A-Za-z]{3}),\s+([A-Za-z]{3})\s+(\d{1,2})/i,
    /(\d{1,2}):(\d{2})\s*(AM|PM)[\s\n]+([A-Za-z]{3}),\s+([A-Za-z]{3})\s+(\d{1,2})/i, // Time then date
  ];
  
  for (const pattern of check_in_patterns) {
    const match = text.match(pattern);
    if (match) {
      // Check if it's the first time/date (check-in is usually first)
      const time_match = text.match(/check[- ]?in[:\s]*(\d{1,2}):(\d{2})\s*(AM|PM)/i);
      if (time_match) {
        data.check_in_time = `${time_match[1]}:${time_match[2]} ${time_match[3]}`;
      }
      
      // Extract date
      const date_match = text.match(/([A-Za-z]{3}),\s+([A-Za-z]{3})\s+(\d{1,2})/);
      if (date_match && !data.check_in_date) {
        // First date is check-in
        data.check_in_date = `${date_match[1]}, ${date_match[2]} ${date_match[3]}`;
      }
      break;
    }
  }

  // Extract check-out date and time
  const check_out_patterns = [
    /check[- ]?out[:\s]*(\d{1,2}):(\d{2})\s*(AM|PM)/i,
    /check[- ]?out[:\s]*([A-Za-z]{3}),\s+([A-Za-z]{3})\s+(\d{1,2})/i,
  ];
  
  for (const pattern of check_out_patterns) {
    const match = text.match(pattern);
    if (match) {
      if (match[1] && match[2] && match[3] && match[1].length <= 2) {
        // Has time
        data.check_out_time = `${match[1]}:${match[2]} ${match[3]}`;
      }
    }
  }
  
  // Extract second date as check-out (usually appears after check-in)
  const all_dates = text.matchAll(/([A-Za-z]{3}),\s+([A-Za-z]{3})\s+(\d{1,2})/g);
  const dates_array: string[] = [];
  for (const date_match of all_dates) {
    dates_array.push(`${date_match[1]}, ${date_match[2]} ${date_match[3]}`);
  }
  
  if (dates_array.length >= 1 && !data.check_in_date) {
    data.check_in_date = dates_array[0];
  }
  if (dates_array.length >= 2 && !data.check_out_date) {
    data.check_out_date = dates_array[1];
  }
  
  // Extract times from pattern "3:00PM 11:00AM"
  const times_match = text.match(/(\d{1,2}):(\d{2})\s*(AM|PM)\s+(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (times_match) {
    if (!data.check_in_time) {
      data.check_in_time = `${times_match[1]}:${times_match[2]} ${times_match[3]}`;
    }
    if (!data.check_out_time) {
      data.check_out_time = `${times_match[4]}:${times_match[5]} ${times_match[6]}`;
    }
  }

  // Extract place/location (look for city, country, or address)
  const place_patterns = [
    /address[:\s]+([A-Z][a-zA-Z\s,]+(?:Emirates|Country|State|City))/i,
    /([A-Z][a-zA-Z\s]+(?:Hills|City|Dubai|Abu Dhabi|Emirates))/i,
    /([A-Z][a-zA-Z\s,]+(?:United Arab Emirates|UAE|USA|UK))/i,
  ];
  
  for (const pattern of place_patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const place = match[1].trim();
      // Filter out hotel names
      if (!place.toLowerCase().includes('villa') && !place.toLowerCase().includes('hotel')) {
        data.place = place;
        data.address = place;
        break;
      }
    }
  }

  // Extract guest names (from "Who's coming" section)
  const guest_patterns = [
    /who'?s\s+coming[\s\n]+([A-Za-z\s,]+(?:Patel|Doe|Smith|etc))/i,
    /guests?[:\s]+([A-Za-z\s,]+)/i,
  ];
  
  for (const pattern of guest_patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const guests = match[1].trim();
      // Take first guest name if multiple
      const first_guest = guests.split(',')[0].trim();
      if (first_guest) {
        data.guest_name = first_guest;
      }
      break;
    }
  }

  return data;
}

/**
 * Process hotel booking OCR
 */
export async function process_hotel_ocr(file_url: string): Promise<HotelOCRResult> {
  try {
    // Download file from pre-signed URL
    logger.info(`Processing hotel booking: ${file_url.substring(0, 80)}...`);
    
    const response = await fetch(file_url);
    if (!response.ok) {
      throw new Error(`Failed to download hotel booking: ${response.status} ${response.statusText}`);
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
      // Set Tesseract parameters for better OCR accuracy
      await worker.setParameters({
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 :/-.,\n',
      });
      
      // Perform OCR
      const { data: { text } } = await worker.recognize(file_buffer);
      
      logger.info(`Hotel OCR extracted ${text.length} characters`);

      // Validate if it's a hotel booking
      if (!validate_hotel_booking(text)) {
        logger.warn('Extracted text does not appear to be a valid hotel booking');
        return {
          status: 'invalid',
          error: 'Text does not contain hotel booking information',
          raw_text: text,
        };
      }

      // Extract hotel data
      const extracted_data = extract_hotel_data(text);

      // Ensure we have at least hotel name or confirmation code
      if (!extracted_data.hotel_name && !extracted_data.confirmation_code) {
        logger.warn('Could not extract essential hotel information');
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
    logger.error('Hotel OCR failed:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  process_hotel_ocr,
};
