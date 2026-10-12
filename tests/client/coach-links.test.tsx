import React from 'react';
import { test, expect, afterEach } from '@jest/globals';
import { render, screen, cleanup } from '@testing-library/react';
import { linkifyText } from '../../client/src/utils/coach/linkify';

afterEach(cleanup);
const directions = 'https://www.google.com/maps/dir/?api=1&destination=12+Main+St&travelmode=driving&dir_action=navigate';
test('Coach renders a labeled directions link separately from a source', () => {
  render(<div>{linkifyText(`Go here: [Directions](${directions}). [Source](https://venue.example/hours)`)}</div>);
  expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', directions);
  expect(screen.getByRole('link', { name: 'Source' })).toHaveAttribute('href', 'https://venue.example/hours');
  expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('rel', 'noopener noreferrer');
});
test.each(['https://venue.example', 'https://www.google.com.evil.example/maps/dir/?api=1&destination=12+Main'])('a website cannot be mislabeled as navigation: %s', website => {
  render(<div>{linkifyText(`[Navigate to venue](${website})`)}</div>);
  expect(screen.queryByRole('link', { name: /Navigate/ })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute('href', website);
});
test('old plain-text Navigate website links stay usable with an honest label', () => {
  render(<div>{linkifyText('Navigate: https://venue.example.')}</div>);
  expect(screen.getByText(/Website:/)).toBeInTheDocument();
  expect(screen.getByRole('link')).toHaveAttribute('href', 'https://venue.example');
});
test('map search remains labeled Map, rather than pretending to be directions', () => {
  render(<div>{linkifyText('[Directions](https://www.google.com/maps/search/?api=1&query=Fixture)')}</div>);
  expect(screen.getByRole('link', { name: 'Map' })).toHaveAttribute('href', expect.stringContaining('/maps/search/'));
});
test('bare directions are usable and unsupported URL schemes stay escaped text', () => {
  render(<div>{linkifyText(`${directions}. [Directions](javascript:alert(1)) <img src=x onerror=alert(1)>`)}</div>);
  expect(screen.getAllByRole('link')).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Directions' })).toHaveAttribute('href', directions);
  expect(document.querySelector('img')).toBeNull();
});
