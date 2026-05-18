/**
 * Unit tests for client-side scheduling utilities.
 * Pure mathematical functions — no network, no DB, no DOM interaction.
 */
import { describe, it, expect, vi } from 'vitest';

// ─── Mock @/lib/logger to avoid import.meta.env usage ────────────────────────

vi.mock('@/lib/logger', () => ({
  clientLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    log: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ─── Imports ───────────────────────────────────────────────────────────────────

import {
  timeToMinutes,
  minutesToTime,
  haversineDistance,
  calculateTravelTime,
  MAX_TRAVEL_TIME_MINUTES,
  MAX_TRAVEL_TIME_MINUTES_WALKER,
} from '@/utils/scheduling-utils';

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Travel time constants', () => {
  it('MAX_TRAVEL_TIME_MINUTES is 45', () => {
    expect(MAX_TRAVEL_TIME_MINUTES).toBe(45);
  });

  it('MAX_TRAVEL_TIME_MINUTES_WALKER is 60', () => {
    expect(MAX_TRAVEL_TIME_MINUTES_WALKER).toBe(60);
  });

  it('walker cap is greater than car cap', () => {
    expect(MAX_TRAVEL_TIME_MINUTES_WALKER).toBeGreaterThan(MAX_TRAVEL_TIME_MINUTES);
  });
});

// ─── timeToMinutes ────────────────────────────────────────────────────────────

describe('timeToMinutes', () => {
  it('converts "00:00" to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts "09:00" to 540', () => {
    expect(timeToMinutes('09:00')).toBe(540);
  });

  it('converts "23:59" to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });

  it('converts "12:30" to 750', () => {
    expect(timeToMinutes('12:30')).toBe(750);
  });

  it('adds 24h for early times (0–5h) when allowNextDay is true', () => {
    // 02:00 → 120 minutes + 1440 (next day) = 1560
    expect(timeToMinutes('02:00', true)).toBe(2 * 60 + 24 * 60);
  });

  it('does not add 24h for times at 06:00 or later even with allowNextDay', () => {
    expect(timeToMinutes('06:00', true)).toBe(6 * 60);
    expect(timeToMinutes('09:00', true)).toBe(9 * 60);
  });

  it('does not add 24h for early times when allowNextDay is false (default)', () => {
    expect(timeToMinutes('02:00')).toBe(120);
    expect(timeToMinutes('02:00', false)).toBe(120);
  });
});

// ─── minutesToTime ────────────────────────────────────────────────────────────

describe('minutesToTime', () => {
  it('converts 0 to "00:00"', () => {
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('converts 540 to "09:00"', () => {
    expect(minutesToTime(540)).toBe('09:00');
  });

  it('converts 1439 to "23:59"', () => {
    expect(minutesToTime(1439)).toBe('23:59');
  });

  it('pads single-digit hours and minutes', () => {
    expect(minutesToTime(65)).toBe('01:05');
  });

  it('roundtrips with timeToMinutes for standard times', () => {
    const times = ['00:00', '08:30', '13:15', '22:45', '23:59'];
    for (const t of times) {
      expect(minutesToTime(timeToMinutes(t))).toBe(t);
    }
  });
});

// ─── haversineDistance ────────────────────────────────────────────────────────

describe('haversineDistance', () => {
  it('returns 0 for identical points', () => {
    const p = { lat: 55.86, lng: -4.25 };
    expect(haversineDistance(p, p)).toBeCloseTo(0, 5);
  });

  it('is symmetric (A→B equals B→A)', () => {
    const glasgow = { lat: 55.8617, lng: -4.2583 };
    const edinburgh = { lat: 55.9533, lng: -3.1883 };
    const d1 = haversineDistance(glasgow, edinburgh);
    const d2 = haversineDistance(edinburgh, glasgow);
    expect(d1).toBeCloseTo(d2, 5);
  });

  it('gives a reasonable distance for Glasgow → Edinburgh (~60–80 km)', () => {
    const glasgow = { lat: 55.8617, lng: -4.2583 };
    const edinburgh = { lat: 55.9533, lng: -3.1883 };
    const dist = haversineDistance(glasgow, edinburgh);
    expect(dist).toBeGreaterThan(60);
    expect(dist).toBeLessThan(80);
  });

  it('gives a reasonable distance for London → Manchester (~250–280 km)', () => {
    const london = { lat: 51.5074, lng: -0.1278 };
    const manchester = { lat: 53.4808, lng: -2.2426 };
    const dist = haversineDistance(london, manchester);
    expect(dist).toBeGreaterThan(250);
    expect(dist).toBeLessThan(280);
  });

  it('returns value in kilometres (positive number)', () => {
    const a = { lat: 56.0, lng: -4.0 };
    const b = { lat: 56.1, lng: -4.1 };
    const dist = haversineDistance(a, b);
    expect(dist).toBeGreaterThan(0);
    expect(dist).toBeLessThan(20); // ~13 km
  });
});

// ─── calculateTravelTime ──────────────────────────────────────────────────────

describe('calculateTravelTime', () => {
  describe('car', () => {
    it('has a minimum of 5 minutes regardless of distance', () => {
      expect(calculateTravelTime(0, 'car')).toBe(5);
      expect(calculateTravelTime(0.001, 'car')).toBe(5);
    });

    it('grows with distance', () => {
      const short = calculateTravelTime(1, 'car');
      const medium = calculateTravelTime(5, 'car');
      const long = calculateTravelTime(20, 'car');
      expect(medium).toBeGreaterThan(short);
      expect(long).toBeGreaterThan(medium);
    });

    it('5 km gives a reasonable car travel time (5–15 min)', () => {
      expect(calculateTravelTime(5, 'car')).toBeGreaterThanOrEqual(5);
      expect(calculateTravelTime(5, 'car')).toBeLessThanOrEqual(15);
    });
  });

  describe('walking', () => {
    it('has a minimum of 2 minutes', () => {
      expect(calculateTravelTime(0, 'walking')).toBe(2);
    });

    it('takes significantly longer than car for the same distance', () => {
      const carTime = calculateTravelTime(3, 'car');
      const walkTime = calculateTravelTime(3, 'walking');
      expect(walkTime).toBeGreaterThan(carTime);
    });

    it('5 km walking gives a reasonable time (60–90 min)', () => {
      const t = calculateTravelTime(5, 'walking');
      expect(t).toBeGreaterThanOrEqual(60);
      expect(t).toBeLessThanOrEqual(90);
    });
  });

  describe('public transport', () => {
    it('has a fixed 15-minute overhead even for zero distance', () => {
      expect(calculateTravelTime(0, 'public')).toBe(15);
    });

    it('minimum is 15 minutes', () => {
      expect(calculateTravelTime(0.001, 'public')).toBe(15);
    });

    it('takes longer than car but (usually) shorter than walking for medium distances', () => {
      const carTime = calculateTravelTime(10, 'car');
      const publicTime = calculateTravelTime(10, 'public');
      const walkTime = calculateTravelTime(10, 'walking');
      expect(publicTime).toBeGreaterThan(carTime);
      expect(publicTime).toBeLessThan(walkTime);
    });
  });

  it('returns an integer (no fractional minutes)', () => {
    const result = calculateTravelTime(7.3, 'car');
    expect(Number.isInteger(result)).toBe(true);
  });
});
