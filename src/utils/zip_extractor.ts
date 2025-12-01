import AdmZip from 'adm-zip';
import * as path from 'path';
import * as fs from 'fs';

export interface PassengerFolder {
  passenger_name: string;
  files: PassengerFile[];
}

export interface PassengerFile {
  filename: string;
  file_path: string;
  file_type: string; // passport_front, passport_back, flight, hotel, photo, etc.
}

/**
 * Extract zip file and parse passenger folders
 * Expected structure: main_folder/passengers/passenger_name/files
 * Supports both old structure (passenger_name/files) and new structure (main_folder/passengers/passenger_name/files)
 */
export async function extract_zip_file(zip_file_path: string): Promise<PassengerFolder[]> {
  const passengers: PassengerFolder[] = [];
  
  try {
    const zip = new AdmZip(zip_file_path);
    const zip_entries = zip.getEntries();

    // Group entries by folder (passenger name)
    const passenger_map = new Map<string, string[]>();

    for (const entry of zip_entries) {
      // Skip directories
      if (entry.isDirectory) {
        continue;
      }

      // Get folder structure
      const entry_path = entry.entryName;
      const path_parts = entry_path.split('/').filter((p: string) => p.length > 0);
      
      if (path_parts.length < 2) {
        // Files in root, skip
        continue;
      }

      // Handle different structures:
      // 1. main_folder/passengers/passenger_name/files
      // 2. main_folder/passenger_name/files (no passengers folder)
      // 3. passenger_name/files (old structure)
      let passenger_name: string;
      let filename: string;

      // Check if structure is main_folder/passengers/passenger_name/files
      if (path_parts.length >= 3 && path_parts[1].toLowerCase() === 'passengers') {
        passenger_name = path_parts[2];
        filename = path_parts[path_parts.length - 1];
      } else if (path_parts.length >= 2) {
        // Structure: main_folder/passenger_name/files (no passengers folder)
        // Skip the first part (main folder) and use the second part as passenger name
        passenger_name = path_parts[1];
        filename = path_parts[path_parts.length - 1];
      } else {
        // Old structure: passenger_name/files
        passenger_name = path_parts[0];
        filename = path_parts[path_parts.length - 1];
      }

      if (!passenger_name || !filename) {
        continue;
      }

      if (!passenger_map.has(passenger_name)) {
        passenger_map.set(passenger_name, []);
      }

      // Extract file to temp location
      const temp_dir = path.join(process.cwd(), 'temp', passenger_name);
      if (!fs.existsSync(temp_dir)) {
        fs.mkdirSync(temp_dir, { recursive: true });
      }

      const file_path = path.join(temp_dir, filename);
      zip.extractEntryTo(entry, temp_dir, false, true);

      const existing_files = passenger_map.get(passenger_name);
      if (existing_files) {
        existing_files.push(file_path);
      }
    }

    // Convert to PassengerFolder structure
    for (const [passenger_name, file_paths] of passenger_map.entries()) {
      const files: PassengerFile[] = file_paths.map(file_path => {
        const filename = path.basename(file_path);
        const ext = path.extname(filename).toLowerCase();
        
        // Determine file type based on filename
        const lower_filename = filename.toLowerCase();
        let file_type = 'other';
        
        // Check for passport files (front/back) - prioritize PPF/PPB patterns
        // PPF = Passport Front, PPB = Passport Back
        if (lower_filename.includes('ppf') || lower_filename.match(/\bppf\b/i)) {
          file_type = 'passport_front';
        } else if (lower_filename.includes('ppb') || lower_filename.match(/\bppb\b/i)) {
          file_type = 'passport_back';
        } else if (lower_filename.includes('passport')) {
          if (lower_filename.includes('front') || lower_filename.includes('_f') || lower_filename.match(/passport.*front/i)) {
            file_type = 'passport_front';
          } else if (lower_filename.includes('back') || lower_filename.includes('_b') || lower_filename.match(/passport.*back/i)) {
            file_type = 'passport_back';
          } else {
            file_type = 'passport';
          }
        } else if (lower_filename.includes('front') && (lower_filename.includes('passport') || lower_filename.match(/^front/i))) {
          file_type = 'passport_front';
        } else if (lower_filename.includes('back') && (lower_filename.includes('passport') || lower_filename.match(/^back/i))) {
          file_type = 'passport_back';
        } else if (lower_filename.includes('flight') || (lower_filename.includes('ticket') && !lower_filename.includes('hotel'))) {
          file_type = 'flight';
        } else if (lower_filename.includes('visa')) {
          file_type = 'visa';
        } else if (lower_filename.includes('photo') || lower_filename.includes('picture')) {
          file_type = 'photo';
        } else if (lower_filename.includes('hotel') || lower_filename.includes('accommodation')) {
          file_type = 'hotel';
        } else if (lower_filename.includes('bank') || lower_filename.includes('statement')) {
          file_type = 'bank_statement';
        } else if (lower_filename.includes('aadhaar')) {
          file_type = 'aadhaar';
        } else if (lower_filename.includes('pan')) {
          file_type = 'pan';
        }

        return {
          filename,
          file_path,
          file_type,
        };
      });

      passengers.push({
        passenger_name,
        files,
      });
    }

    return passengers;
  } catch (error) {
    throw new Error(`Failed to extract zip file: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Clean up temporary extracted files
 */
export async function cleanup_temp_files(passengers: PassengerFolder[]): Promise<void> {
  for (const passenger of passengers) {
    for (const file of passenger.files) {
      try {
        if (fs.existsSync(file.file_path)) {
          fs.unlinkSync(file.file_path);
        }
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Remove passenger directory
    const passenger_dir = path.dirname(passenger.files[0]?.file_path || '');
    if (passenger_dir && fs.existsSync(passenger_dir)) {
      try {
        fs.rmSync(passenger_dir, { recursive: true, force: true });
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

