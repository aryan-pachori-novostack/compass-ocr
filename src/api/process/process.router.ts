import { Router, type Request, type Response } from 'express';
import { process_passport_ocr } from '../../services/passport.service.js';
import { process_flight_ocr } from '../../services/flight.service.js';
import { process_hotel_ocr } from '../../services/hotel.service.js';
import { map_ticket_to_passenger } from '../../services/mapping.service.js';
import { publish_to_redis } from '../../config/redis.js';
import { env } from '../../config/env.js';
import logger from '../../utils/logger.js';

const process_router = Router();

interface DocumentPayload {
  traveller_id: string;
  traveller_name: string;
  document_id: string;
  file_url: string; // Pre-signed URL from main backend
  document_type: string;
}

interface ProcessDocumentsRequest {
  order_id: string;
  documents: DocumentPayload[];
}

/**
 * POST /process/documents - Process documents for OCR
 * Receives pre-signed URLs from main backend, downloads files, processes OCR, and updates database
 */
process_router.post('/documents', async (req: Request, res: Response): Promise<void> => {
  try {
    const { order_id, documents } = req.body as ProcessDocumentsRequest;

    if (!order_id || !documents || !Array.isArray(documents)) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'order_id and documents array are required',
        code: 400,
      });
      return;
    }

    // Return immediately (async processing)
    res.status(202).json({
      status: 'accepted',
      message: 'Documents are being processed',
      order_id,
    });

    // Process documents asynchronously
    setImmediate(async () => {
      try {
        await process_documents_async(order_id, documents);
      } catch (error) {
        logger.error(`Error processing documents for order ${order_id}:`, error);
      }
    });
  } catch (error) {
    logger.error('Error in process documents endpoint:', error);
    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: error instanceof Error ? error.message : 'Failed to process documents',
      code: 500,
    });
  }
});

/**
 * Process documents asynchronously
 */
async function process_documents_async(
  order_id: string,
  documents: DocumentPayload[]
): Promise<void> {
  const channel = `${env.redis.ocr_progress_channel}:${order_id}`;
  
  try {
    logger.info(`Processing ${documents.length} documents for order ${order_id}`);

    // Group documents by type and traveller
    const passport_docs = new Map<string, { front?: DocumentPayload; back?: DocumentPayload }>();
    const flight_docs: DocumentPayload[] = [];
    const hotel_docs: DocumentPayload[] = [];

    for (const doc of documents) {
      if (doc.document_type === 'passport_front' || doc.document_type === 'passport_back') {
        if (!passport_docs.has(doc.traveller_id)) {
          passport_docs.set(doc.traveller_id, {});
        }
        const passport_pair = passport_docs.get(doc.traveller_id)!;
        if (doc.document_type === 'passport_front') {
          passport_pair.front = doc;
        } else {
          passport_pair.back = doc;
        }
      } else if (doc.document_type === 'flight') {
        flight_docs.push(doc);
      } else if (doc.document_type === 'hotel') {
        hotel_docs.push(doc);
      }
    }

    // Process passports (need both front and back)
    for (const [traveller_id, passport_pair] of passport_docs.entries()) {
      if (passport_pair.front && passport_pair.back) {
        try {
          const traveller_name = passport_pair.front.traveller_name;
          
          // Publish processing status
          await publish_progress(channel, {
            order_id,
            traveller_id,
            traveller_name,
            document_id: passport_pair.front.document_id,
            document_type: 'passport',
            status: 'processing',
          });

          // Process passport OCR
          const passport_result = await process_passport_ocr(
            passport_pair.front.file_url,
            passport_pair.back.file_url
          );

          // Publish completion status
          await publish_progress(channel, {
            order_id,
            traveller_id,
            traveller_name,
            document_id: passport_pair.front.document_id,
            document_type: 'passport',
            status: passport_result.status === 'success' ? 'mapped' : 'failed',
            extracted_data: passport_result.data,
            error: passport_result.error,
          });

          // Update main backend with passport OCR results
          await update_main_backend_with_passport(
            order_id,
            traveller_id,
            passport_pair.front.document_id,
            passport_pair.back.document_id,
            passport_result
          );
        } catch (error) {
          logger.error(`Failed to process passport for traveller ${traveller_id}:`, error);
          await publish_progress(channel, {
            order_id,
            traveller_id,
            traveller_name: passport_pair.front?.traveller_name || '',
            document_id: passport_pair.front?.document_id || '',
            document_type: 'passport',
            status: 'failed',
            error: error instanceof Error ? error.message : 'Unknown error',
          });
        }
      }
    }

    // Process flight tickets
    for (const flight_doc of flight_docs) {
      try {
        // Publish processing status
        await publish_progress(channel, {
          order_id,
          traveller_id: flight_doc.traveller_id,
          traveller_name: flight_doc.traveller_name,
          document_id: flight_doc.document_id,
          document_type: 'flight',
          status: 'processing',
        });

        // Process flight OCR
        const flight_result = await process_flight_ocr(flight_doc.file_url);

        if (flight_result.status === 'success' && flight_result.data) {
          // Map to passenger
          const all_travellers = documents.map(d => ({
            traveller_id: d.traveller_id,
            traveller_name: d.traveller_name,
          }));
          const mapped_traveller_id = map_ticket_to_passenger(
            flight_result.data.passenger_name,
            all_travellers
          ) || flight_doc.traveller_id;

          // Publish completion status
          await publish_progress(channel, {
            order_id,
            traveller_id: mapped_traveller_id,
            traveller_name: all_travellers.find(t => t.traveller_id === mapped_traveller_id)?.traveller_name || flight_doc.traveller_name,
            document_id: flight_doc.document_id,
            document_type: 'flight',
            status: 'mapped',
            extracted_data: flight_result.data,
          });

          // Update main backend with flight OCR results
          await update_main_backend_with_ticket(
            order_id,
            mapped_traveller_id,
            flight_doc.document_id,
            'flight',
            flight_result
          );
        } else {
          await publish_progress(channel, {
            order_id,
            traveller_id: flight_doc.traveller_id,
            traveller_name: flight_doc.traveller_name,
            document_id: flight_doc.document_id,
            document_type: 'flight',
            status: 'failed',
            error: flight_result.error,
          });
        }
      } catch (error) {
        logger.error(`Failed to process flight ticket for document ${flight_doc.document_id}:`, error);
        await publish_progress(channel, {
          order_id,
          traveller_id: flight_doc.traveller_id,
          traveller_name: flight_doc.traveller_name,
          document_id: flight_doc.document_id,
          document_type: 'flight',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    // Process hotel tickets
    for (const hotel_doc of hotel_docs) {
      try {
        // Publish processing status
        await publish_progress(channel, {
          order_id,
          traveller_id: hotel_doc.traveller_id,
          traveller_name: hotel_doc.traveller_name,
          document_id: hotel_doc.document_id,
          document_type: 'hotel',
          status: 'processing',
        });

        // Process hotel OCR
        const hotel_result = await process_hotel_ocr(hotel_doc.file_url);

        if (hotel_result.status === 'success' && hotel_result.data) {
          // Map to passenger
          const all_travellers = documents.map(d => ({
            traveller_id: d.traveller_id,
            traveller_name: d.traveller_name,
          }));
          const mapped_traveller_id = map_ticket_to_passenger(
            hotel_result.data.guest_name,
            all_travellers
          ) || hotel_doc.traveller_id;

          // Publish completion status
          await publish_progress(channel, {
            order_id,
            traveller_id: mapped_traveller_id,
            traveller_name: all_travellers.find(t => t.traveller_id === mapped_traveller_id)?.traveller_name || hotel_doc.traveller_name,
            document_id: hotel_doc.document_id,
            document_type: 'hotel',
            status: 'mapped',
            extracted_data: hotel_result.data,
          });

          // Update main backend with hotel OCR results
          await update_main_backend_with_ticket(
            order_id,
            mapped_traveller_id,
            hotel_doc.document_id,
            'hotel',
            hotel_result
          );
        } else {
          await publish_progress(channel, {
            order_id,
            traveller_id: hotel_doc.traveller_id,
            traveller_name: hotel_doc.traveller_name,
            document_id: hotel_doc.document_id,
            document_type: 'hotel',
            status: 'failed',
            error: hotel_result.error,
          });
        }
      } catch (error) {
        logger.error(`Failed to process hotel ticket for document ${hotel_doc.document_id}:`, error);
        await publish_progress(channel, {
          order_id,
          traveller_id: hotel_doc.traveller_id,
          traveller_name: hotel_doc.traveller_name,
          document_id: hotel_doc.document_id,
          document_type: 'hotel',
          status: 'failed',
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    logger.info(`Completed processing documents for order ${order_id}`);
  } catch (error) {
    logger.error(`Failed to process documents for order ${order_id}:`, error);
    throw error;
  }
}

/**
 * Update main backend with passport OCR results
 */
async function update_main_backend_with_passport(
  order_id: string,
  traveller_id: string,
  passport_front_doc_id: string,
  passport_back_doc_id: string,
  passport_result: any
): Promise<void> {
  try {
    const response = await fetch(
      `${env.main_backend.url}/order/${order_id}/ocr-results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          traveller_id,
          ticket_type: 'passport',
          passport_front_doc_id,
          passport_back_doc_id,
          ocr_status: passport_result.status === 'success' ? 'COMPLETED' : 'FAILED',
          ocr_extracted_data: passport_result,
        }),
      }
    );

    if (!response.ok) {
      const error_text = await response.text();
      logger.warn(`Failed to update main backend with passport: ${response.status} - ${error_text}`);
    } else {
      logger.info(`Updated main backend with passport OCR for traveller ${traveller_id}`);
    }
  } catch (error) {
    logger.error('Error updating main backend with passport:', error);
  }
}

/**
 * Update main backend with ticket (flight/hotel) OCR results
 */
async function update_main_backend_with_ticket(
  order_id: string,
  traveller_id: string,
  document_id: string,
  ticket_type: 'flight' | 'hotel',
  ticket_result: any
): Promise<void> {
  try {
    const response = await fetch(
      `${env.main_backend.url}/order/${order_id}/ocr-results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          traveller_id,
          ticket_type,
          document_id,
          ocr_status: ticket_result.status === 'success' ? 'COMPLETED' : 'FAILED',
          ocr_extracted_data: ticket_result,
          mapped_to_traveller_id: traveller_id,
        }),
      }
    );

    if (!response.ok) {
      const error_text = await response.text();
      logger.warn(`Failed to update main backend with ${ticket_type}: ${response.status} - ${error_text}`);
    } else {
      logger.info(`Updated main backend with ${ticket_type} OCR for traveller ${traveller_id}`);
    }
  } catch (error) {
    logger.error(`Error updating main backend with ${ticket_type}:`, error);
  }
}

/**
 * Publish progress update to Redis
 */
async function publish_progress(
  channel: string,
  data: {
    order_id: string;
    traveller_id: string;
    traveller_name: string;
    document_id: string;
    document_type: string;
    status: string;
    extracted_data?: any;
    error?: string;
  }
): Promise<void> {
  const message = JSON.stringify({
    ...data,
    timestamp: new Date().toISOString(),
  });

  await publish_to_redis(channel, message);
  logger.debug(`Published progress to ${channel}: ${data.document_type} ${data.status} for ${data.traveller_name}`);
}

export default process_router;
