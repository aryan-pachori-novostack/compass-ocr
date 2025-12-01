import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { env } from './env.js';
import logger from '../utils/logger.js';

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

/**
 * Extract bucket name from S3 URL
 */
export function extract_bucket_from_url(s3_url: string): string {
  if (s3_url.startsWith('s3://')) {
    const without_protocol = s3_url.replace('s3://', '');
    const first_slash = without_protocol.indexOf('/');
    if (first_slash >= 0) {
      return without_protocol.substring(0, first_slash);
    }
    return without_protocol;
  }
  // For https URLs, try to extract bucket from domain
  if (s3_url.startsWith('https://')) {
    const match = s3_url.match(/https?:\/\/([^.]+)\.s3/);
    if (match) {
      return match[1];
    }
  }
  return env.s3.bucket_name || '';
}

/**
 * Download file from S3
 */
export async function download_from_s3(s3_key: string, bucket_name?: string): Promise<Buffer> {
  try {
    const bucket = bucket_name || env.s3.bucket_name;
    if (!bucket) {
      throw new Error('S3 bucket name not configured. Please set S3_BUCKET_NAME environment variable or provide bucket name.');
    }

    const client = get_s3_client();

    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: s3_key,
    });

    logger.info(`Downloading from S3: bucket=${bucket}, key=${s3_key}`);

    const response = await client.send(command);
    
    if (!response.Body) {
      throw new Error('Empty response body from S3');
    }

    const chunks: Uint8Array[] = [];
    for await (const chunk of response.Body as any) {
      chunks.push(chunk);
    }

    const buffer = Buffer.concat(chunks);
    logger.info(`Downloaded file from S3: ${s3_key} (${buffer.length} bytes)`);

    return buffer;
  } catch (error) {
    logger.error(`Failed to download file from S3: ${s3_key}`, error);
    if (error instanceof Error) {
      logger.error(`Error message: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Extract S3 key from S3 URL
 */
export function extract_s3_key_from_url(s3_url: string): string {
  // Handle s3://bucket/key format
  // Example: s3://compass-leverage/orders/.../file.jpg
  // Key should be: orders/.../file.jpg (everything after bucket name)
  if (s3_url.startsWith('s3://')) {
    const without_protocol = s3_url.replace('s3://', '');
    const first_slash = without_protocol.indexOf('/');
    if (first_slash >= 0) {
      // Return everything after the first slash (skip bucket name)
      return without_protocol.substring(first_slash + 1);
    }
    // If no slash, assume entire string is the key (unlikely but handle it)
    return without_protocol;
  }

  // Handle https://bucket.s3.region.amazonaws.com/key format
  if (s3_url.startsWith('https://')) {
    try {
      const url = new URL(s3_url);
      // Remove leading slash if present
      return url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname;
    } catch (error) {
      logger.warn(`Failed to parse URL: ${s3_url}`, error);
      // Fallback: try to extract path manually
      const match = s3_url.match(/https?:\/\/[^\/]+\/(.+)/);
      return match ? match[1] : s3_url;
    }
  }

  // Assume it's already a key
  return s3_url;
}

export default {
  download_from_s3,
  extract_s3_key_from_url,
  extract_bucket_from_url,
};

