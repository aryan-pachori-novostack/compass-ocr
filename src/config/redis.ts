import Redis from 'ioredis';
import { env } from './env.js';
import logger from '../utils/logger.js';

const _RedisConstructor = Redis as unknown as new (...args: any[]) => any;
type RedisClient = InstanceType<typeof _RedisConstructor>;

let redis_publisher: RedisClient | null = null;

/**
 * Get or create Redis publisher client
 */
export function get_redis_publisher(): RedisClient {
  if (!redis_publisher) {
    try {
      redis_publisher = new (Redis as any)(env.redis.url, {
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      redis_publisher.on('connect', () => {
        logger.info('✓ Connected to Redis publisher');
      });

      redis_publisher.on('error', (error: Error) => {
        logger.error('Redis publisher error:', error);
      });

      redis_publisher.on('close', () => {
        logger.warn('Redis publisher connection closed');
      });
    } catch (error) {
      logger.error('Failed to create Redis publisher:', error);
      throw error;
    }
  }
  return redis_publisher;
}

/**
 * Publish message to Redis channel
 */
export async function publish_to_redis(channel: string, message: string): Promise<void> {
  try {
    const publisher = get_redis_publisher();
    await publisher.publish(channel, message);
    logger.debug(`Published message to channel: ${channel}`);
  } catch (error) {
    logger.error(`Failed to publish to Redis channel ${channel}:`, error);
    throw error;
  }
}

export default {
  get_redis_publisher,
  publish_to_redis,
};

