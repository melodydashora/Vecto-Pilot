/**
 * Uber Webhook Handler
 * Receives and processes webhook events from Uber
 */

import { Router } from 'express';
import crypto from 'crypto';
import { db } from '../../db.js';
import { uber_trips, uber_payments, uber_connections } from '../../../shared/schema.js';
import { eq } from 'drizzle-orm';

const router = Router();

/**
 * Verify Uber webhook signature using HMAC-SHA256
 * @param {string} payload - Raw request body
 * @param {string} signature - X-Uber-Signature header value
 * @returns {boolean}
 */
function verifySignature(payload, signature) {
  const secret = process.env.UBER_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('UBER_WEBHOOK_SECRET not configured');
    return false;
  }

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  // Use timing-safe comparison
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Find user by Uber driver ID
 * @param {string} uberDriverId
 * @returns {Promise<{user_id: string} | null>}
 */
async function findUserByUberId(uberDriverId) {
  const [connection] = await db.select({ user_id: uber_connections.user_id })
    .from(uber_connections)
    .where(eq(uber_connections.uber_driver_id, uberDriverId))
    .limit(1);

  return connection || null;
}

/**
 * Process trip completed event
 * @param {Object} data - Event data from webhook
 */
async function processTripCompleted(data) {
  const { trip, driver_id } = data;

  // Find user by Uber driver ID
  const userConn = await findUserByUberId(driver_id);
  if (!userConn) {
    console.warn(`No user found for Uber driver ${driver_id}`);
    return;
  }

  // Insert trip record
  await db.insert(uber_trips)
    .values({
      user_id: userConn.user_id,
      uber_trip_id: trip.trip_id,
      fare: trip.fare?.total || null,
      distance_miles: trip.distance?.value || null,
      duration_minutes: trip.duration?.value ? Math.round(trip.duration.value / 60) : null,
      surge_multiplier: trip.surge?.multiplier || 1.0,
      pickup_time: trip.pickup?.time ? new Date(trip.pickup.time) : null,
      dropoff_time: trip.dropoff?.time ? new Date(trip.dropoff.time) : null,
      pickup_location: trip.pickup?.location ? {
        lat: trip.pickup.location.latitude,
        lng: trip.pickup.location.longitude,
        address: trip.pickup.address,
      } : null,
      dropoff_location: trip.dropoff?.location ? {
        lat: trip.dropoff.location.latitude,
        lng: trip.dropoff.location.longitude,
        address: trip.dropoff.address,
      } : null,
      vehicle_type: trip.vehicle_type,
      raw_data: data,
    })
    .onConflictDoNothing();

  console.log(`Processed trip ${trip.trip_id} for user ${userConn.user_id}`);
}

/**
 * Process payment event
 * @param {Object} data - Event data from webhook
 */
async function processPayment(data) {
  const { payment, driver_id } = data;

  // Find user by Uber driver ID
  const userConn = await findUserByUberId(driver_id);
  if (!userConn) {
    console.warn(`No user found for Uber driver ${driver_id}`);
    return;
  }

  // Find related trip if this is a trip earning
  let relatedTripId = null;
  if (payment.trip_id) {
    const [trip] = await db.select({ id: uber_trips.id })
      .from(uber_trips)
      .where(eq(uber_trips.uber_trip_id, payment.trip_id))
      .limit(1);

    relatedTripId = trip?.id || null;
  }

  // Insert payment record
  await db.insert(uber_payments)
    .values({
      user_id: userConn.user_id,
      uber_payment_id: payment.payment_id,
      amount: payment.amount,
      payment_type: payment.type || 'trip_earning',
      event_time: new Date(payment.timestamp),
      description: payment.description,
      related_trip_id: relatedTripId,
      raw_data: data,
    })
    .onConflictDoNothing();

  console.log(`Processed payment ${payment.payment_id} for user ${userConn.user_id}`);
}

/**
 * POST /api/webhooks/uber
 * Handle incoming Uber webhook events
 */
router.post('/', async (req, res) => {
  // Get raw body for signature verification
  const rawBody = JSON.stringify(req.body);
  const signature = req.headers['x-uber-signature'];

  // Verify webhook signature
  if (!verifySignature(rawBody, signature)) {
    console.warn('Invalid Uber webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { event_type, event_time, data } = req.body;

  console.log(`Received Uber webhook: ${event_type} at ${event_time}`);

  try {
    switch (event_type) {
      case 'trips.completed':
        await processTripCompleted(data);
        break;

      case 'payments.processed':
        await processPayment(data);
        break;

      case 'driver.status_changed':
        // Log driver online/offline status changes
        console.log(`Driver status changed: ${data.driver_id} -> ${data.status}`);
        break;

      default:
        console.log(`Unhandled webhook event type: ${event_type}`);
    }

    // Always respond 200 to acknowledge receipt
    res.status(200).json({ received: true });

  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still return 200 to prevent Uber from retrying
    // Log error for investigation
    res.status(200).json({ received: true, error: 'processing_failed' });
  }
});

/**
 * GET /api/webhooks/uber/health
 * Health check for webhook endpoint
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    configured: !!process.env.UBER_WEBHOOK_SECRET,
    timestamp: new Date().toISOString(),
  });
});

export default router;
