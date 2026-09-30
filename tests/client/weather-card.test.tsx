import React from 'react';
import { describe, expect, test } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { WeatherCard } from '../../client/src/components/briefing/WeatherCard';

describe('WeatherCard source truth', () => {
  test('failed weather does not claim Strategy used fallback facts', () => {
    render(<WeatherCard weatherData={{ _generationFailed: true }} />);
    expect(screen.getByText(/Weather temporarily unavailable/).textContent).toContain('new strategy is waiting');
    expect(screen.queryByText(/fallback context/)).toBeNull();
  });
  test('pending partial weather stays visible as loading', () => {
    const pending = { _pending: true, weather: { current: { tempF: 68 }, forecast: [] } };
    render(<WeatherCard weatherData={pending} />);
    expect(screen.getByText('Loading forecast...')).toBeTruthy();
  });
  test('finished missing data is unavailable rather than hidden or fabricated', () => {
    render(<WeatherCard weatherData={{ weather: { forecast: [] } }} />);
    expect(screen.getByText(/Forecast unavailable/)).toBeTruthy();
  });
  test('missing temperature and source time do not become 0°F or a guessed hour', () => {
    render(<WeatherCard weatherData={{ weather: { forecast: [{ conditions: 'Cloudy' }] } }} timezone="Etc/UTC" />);
    expect(screen.queryByText('0°F')).toBeNull(); expect(screen.queryByText('+1h')).toBeNull();
    expect(screen.getByText('Temperature unavailable')).toBeTruthy();
    expect(screen.getByText('Time unavailable')).toBeTruthy();
  });
  test('measured zero and provider time remain visible in the driver timezone', () => {
    render(<WeatherCard weatherData={{ weather: { forecast: [{ tempF: 0, time: '2026-09-29T12:00:00Z' }] } }} timezone="America/Chicago" />);
    expect(screen.getByText('0°F')).toBeTruthy(); expect(screen.getByText('7 AM')).toBeTruthy();
  });
  test('missing driver timezone cannot silently use the browser timezone', () => {
    render(<WeatherCard weatherData={{ weather: { forecast: [{ tempF: 68, time: '2026-09-29T12:00:00Z' }] } }} />);
    expect(screen.getByText('Time unavailable')).toBeTruthy();
  });
});
