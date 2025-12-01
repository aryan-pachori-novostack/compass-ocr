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
          logger.warn(`Redis retry attempt ${times}, waiting ${delay}ms`);
          return delay;
        },
        maxRetriesPerRequest: 3,
        lazyConnect: true, // Don't connect immediately
        enableOfflineQueue: false, // Don't queue commands if offline
      });

      redis_publisher.on('connect', () => {
        logger.info('✓ Connected to Redis publisher');
      });

      redis_publisher.on('error', (error: Error) => {
        logger.error('Redis publisher error:', error);
        // Don't throw, just log - allow service to continue
      });

      redis_publisher.on('close', () => {
        logger.warn('Redis publisher connection closed');
      });

      // Attempt to connect, but don't fail if it doesn't work
      redis_publisher.connect().catch((error: Error) => {
        logger.warn('Redis connection failed, will retry on first use:', error.message);
      });
    } catch (error) {
      logger.error('Failed to create Redis publisher:', error);
      // Don't throw - create a dummy client that logs errors
      // This allows the service to start even if Redis is unavailable
      redis_publisher = {
        publish: async () => {
          logger.warn('Redis not available, message not published');
        },
        connect: async () => {},
        on: () => {},
      } as any;
    }
  }
  return redis_publisher;
}

/**
 * Publish message to Redis channel
 * Silently fails if Redis is unavailable (logs error but doesn't throw)
 */
export async function publish_to_redis(channel: string, message: string): Promise<void> {
  try {
    const publisher = get_redis_publisher();
    await publisher.publish(channel, message);
    logger.debug(`Published message to channel: ${channel}`);
  } catch (error) {
    logger.error(`Failed to publish to Redis channel ${channel}:`, error);
    // Don't throw - allow service to continue even if Redis is down
    // The frontend will just not receive real-time updates
  }
}

export default {
  get_redis_publisher,
  publish_to_redis,
};

