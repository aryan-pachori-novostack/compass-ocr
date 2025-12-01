import logger from '../utils/logger.js';

export interface TravellerInfo {
  traveller_id: string;
  traveller_name: string;
}

/**
 * Fuzzy match names (simple implementation)
 */
function fuzzy_match_name(name1: string, name2: string): number {
  const normalize = (name: string) => name.toLowerCase().trim().replace(/\s+/g, ' ');
  const n1 = normalize(name1);
  const n2 = normalize(name2);

  // Exact match
  if (n1 === n2) return 1.0;

  // Check if one contains the other
  if (n1.includes(n2) || n2.includes(n1)) return 0.8;

  // Split into words and check common words
  const words1 = n1.split(' ');
  const words2 = n2.split(' ');
  
  const common_words = words1.filter(w => words2.includes(w));
  const total_words = Math.max(words1.length, words2.length);
  
  if (total_words === 0) return 0;
  
  return common_words.length / total_words;
}

/**
 * Map flight/hotel ticket to passenger by name matching
 */
export function map_ticket_to_passenger(
  extracted_name: string | undefined,
  travellers: TravellerInfo[]
): string | null {
  if (!extracted_name || travellers.length === 0) {
    return null;
  }

  let best_match: { traveller_id: string; score: number } | null = null;
  const threshold = 0.6; // Minimum similarity threshold

  for (const traveller of travellers) {
    const score = fuzzy_match_name(extracted_name, traveller.traveller_name);
    
    if (score >= threshold && (!best_match || score > best_match.score)) {
      best_match = {
        traveller_id: traveller.traveller_id,
        score,
      };
    }
  }

  if (best_match) {
    logger.info(
      `Mapped ticket (${extracted_name}) to passenger with score: ${best_match.score.toFixed(2)}`
    );
    return best_match.traveller_id;
  }

  logger.warn(`Could not map ticket (${extracted_name}) to any passenger`);
  return null;
}

export default {
  map_ticket_to_passenger,
};

