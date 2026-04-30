// tests/bot-blocker.test.js
// 2026-04-10: Tests for bot blocker middleware — allowlists and blocking
import { jest, describe, it, expect } from '@jest/globals';
import { botBlocker } from '../server/middleware/bot-blocker.js';

function mockReq(path, userAgent = 'Mozilla/5.0 Chrome/120') {
  return {
    path,
    ip: '127.0.0.1',
    get: (header) => {
      if (header.toLowerCase() === 'user-agent') return userAgent;
      return undefined;
    },
  };
}

function mockRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  };
  return res;
}

describe('botBlocker', () => {
  it('allows /__replit paths through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/__replit'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows /__repl paths through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/__repl'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows /health through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/health'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows /api/health through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/api/health'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('allows /api/hooks/analyze-offer through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/api/hooks/analyze-offer'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks Googlebot user-agent with 403', () => {
    const res = mockRes();
    const next = jest.fn();
    botBlocker(mockReq('/api/strategy', 'Googlebot/2.1'), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('blocks empty user-agent with 403', () => {
    const res = mockRes();
    const next = jest.fn();
    botBlocker(mockReq('/api/strategy', ''), res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows normal browser user-agent through', () => {
    const next = jest.fn();
    botBlocker(mockReq('/api/strategy', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it('blocks suspicious paths with 404', () => {
    const res = mockRes();
    const next = jest.fn();
    botBlocker(mockReq('/.env'), res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows /robots.txt through (for bots to read deny policy)', () => {
    const next = jest.fn();
    botBlocker(mockReq('/robots.txt', 'Googlebot/2.1'), mockRes(), next);
    expect(next).toHaveBeenCalled();
  });
});
