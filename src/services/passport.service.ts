import { env } from '../config/env.js';
import logger from '../utils/logger.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface PassportOCRResult {
  status: 'success' | 'error';
  data?: {
    full_name?: string;
    passport_number?: string;
    date_of_birth?: string;
    expiry_date?: string;
    nationality?: string;
    place_of_birth?: string;
    gender?: string;
    [key: string]: any;
  };
  error?: string;
  raw_result?: any;
}

/**
 * Process passport OCR using Gridlines API
 */
export async function process_passport_ocr(
  file_front_url: string,
  file_back_url: string
): Promise<PassportOCRResult> {
  try {
    // Download files from pre-signed URLs
    logger.info(`Processing passport: front=${file_front_url.substring(0, 80)}..., back=${file_back_url.substring(0, 80)}...`);
    
    let front_buffer: Buffer;
    let back_buffer: Buffer;

    // Download front image
    const front_response = await fetch(file_front_url);
    if (!front_response.ok) {
      throw new Error(`Failed to download passport front: ${front_response.status} ${front_response.statusText}`);
    }
    front_buffer = Buffer.from(await front_response.arrayBuffer());

    // Download back image
    const back_response = await fetch(file_back_url);
    if (!back_response.ok) {
      throw new Error(`Failed to download passport back: ${back_response.status} ${back_response.statusText}`);
    }
    back_buffer = Buffer.from(await back_response.arrayBuffer());

    // Create temporary files
    const temp_dir = os.tmpdir();
    const front_temp_path = path.join(temp_dir, `passport_front_${Date.now()}.jpg`);
    const back_temp_path = path.join(temp_dir, `passport_back_${Date.now()}.jpg`);

    fs.writeFileSync(front_temp_path, front_buffer);
    fs.writeFileSync(back_temp_path, back_buffer);

    try {
      // Call Gridlines API
      // Use form-data package for Node.js compatibility
      const FormData = (await import('form-data')).default;
      const form_data = new FormData();
      
      form_data.append('file_front', front_buffer, {
        filename: 'passport_front.jpg',
        contentType: 'image/jpeg',
      });
      form_data.append('file_back', back_buffer, {
        filename: 'passport_back.jpg',
        contentType: 'image/jpeg',
      });
      form_data.append('consent', 'Y');

      // Gridlines API expects specific format
      const response = await fetch(env.gridlines.api_url, {
        method: 'POST',
        headers: {
          'X-API-Key': env.gridlines.api_key,
          'X-Auth-Type': env.gridlines.auth_type,
          'X-Reference-ID': `passport_${Date.now()}`,
          ...form_data.getHeaders(), // Add Content-Type with boundary for multipart/form-data
        },
        body: form_data as any,
      });

      if (!response.ok) {
        const error_text = await response.text();
        throw new Error(`Gridlines API error: ${response.status} - ${error_text}`);
      }

      const result: any = await response.json();

      // Extract relevant data
      const extracted_data: PassportOCRResult['data'] = {
        full_name: result.full_name || result.name || result.passport_holder_name,
        passport_number: result.passport_number || result.passport_no,
        date_of_birth: result.date_of_birth || result.dob,
        expiry_date: result.expiry_date || result.expiration_date,
        nationality: result.nationality || result.country,
        place_of_birth: result.place_of_birth,
        gender: result.gender || result.sex,
        ...(result as Record<string, any>),
      };

      logger.info('Passport OCR completed successfully');

      return {
        status: 'success',
        data: extracted_data,
        raw_result: result,
      };
    } finally {
      // Clean up temp files
      try {
        if (fs.existsSync(front_temp_path)) fs.unlinkSync(front_temp_path);
        if (fs.existsSync(back_temp_path)) fs.unlinkSync(back_temp_path);
      } catch (error) {
        logger.warn('Failed to clean up temp files:', error);
      }
    }
  } catch (error) {
    logger.error('Passport OCR failed:', error);
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export default {
  process_passport_ocr,
};

