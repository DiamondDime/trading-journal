/**
 * POST /api/activities/spread — alias for /api/spreads (POST).
 *
 * Reuses the legacy handler so the wizard server action can target a
 * single /api/activities/* family of endpoints. The spread create flow is
 * fundamentally different from the manual subtypes (it consumes Position
 * IDs to compose legs), so the implementation stays in /api/spreads.
 */
export { POST } from '../../spreads/route';
