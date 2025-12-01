import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';
import logger from './logger.js';
import * as fs from 'fs';

let s3_client: S3Client | null = null;

/**
 * Get or create S3 client
 */
function get_s3_client(): S3Client {
  if (!s3_client) {
    // Check if credentials are provided
    if (!env.s3.access_key_id || !env.s3.secret_access_key) {
      throw new Error('AWS credentials not configured. Please set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY environment variables.');
    }

    s3_client = new S3Client({
      region: env.s3.region,
      credentials: {
        accessKeyId: env.s3.access_key_id,
        secretAccessKey: env.s3.secret_access_key,
      },
    });
  }
  return s3_client;
}

export interface UploadToS3Options {
  file_path: string;
  s3_key: string;
  content_type?: string;
  metadata?: Record<string, string>;
}

/**
 * Upload file to S3
 */
export async function upload_to_s3(options: UploadToS3Options): Promise<string> {
  const { file_path, s3_key, content_type, metadata } = options;

  if (!fs.existsSync(file_path)) {
    throw new Error(`File not found: ${file_path}`);
  }

  try {
    const client = get_s3_client();
    const file_buffer = fs.readFileSync(file_path);

    const command = new PutObjectCommand({
      Bucket: env.s3.bucket_name,
      Key: s3_key,
      Body: file_buffer,
      ContentType: content_type || 'application/octet-stream',
      Metadata: metadata,
    });

    await client.send(command);

    const s3_url = `s3://${env.s3.bucket_name}/${s3_key}`;

    logger.info(`File uploaded to S3: ${s3_url}`);

    return s3_url;
  } catch (error) {
    logger.error(`Failed to upload file to S3: ${file_path}`, error);
    throw error;
  }
}

export default {
  upload_to_s3,
};

