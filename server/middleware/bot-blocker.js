// server/middleware/bot-blocker.js
// ============================================================================
// BOT BLOCKER MIDDLEWARE
// ============================================================================
//
// Blocks known web crawlers and bots from accessing the API
// robots.txt is just a suggestion - this actively rejects bot requests
//
// ============================================================================

// Known bot user agent patterns (case-insensitive matching)
const BOT_PATTERNS = [
  // Search engine crawlers
  /googlebot/i,
  /bingbot/i,
  /slurp/i,           // Yahoo
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /sogou/i,
  /exabot/i,
  /facebot/i,
  /ia_archiver/i,     // Alexa

  // Social media bots
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /pinterest/i,
  /whatsapp/i,
  /telegrambot/i,
  /slackbot/i,
  /discordbot/i,

  // SEO/Analytics bots
  /ahrefsbot/i,
  /semrushbot/i,
  /mj12bot/i,         // Majestic
  /dotbot/i,          // Moz
  /petalbot/i,        // Huawei
  /rogerbot/i,        // Moz
  /screaming frog/i,
  /seokicks/i,
  /blexbot/i,

  // AI crawlers
  /gptbot/i,          // OpenAI
  /ccbot/i,           // Common Crawl
  /anthropic-ai/i,
  /claude-web/i,
  /perplexitybot/i,
  /cohere-ai/i,
  /bytespider/i,      // TikTok/ByteDance

  // Generic bot patterns
  /bot\b/i,
  /crawler/i,
  /spider/i,
  /scraper/i,
  /headless/i,
  /phantom/i,
  /selenium/i,
  /puppeteer/i,
  /playwright/i,

  // Vulnerability scanners
  /nmap/i,
  /nikto/i,
  /sqlmap/i,
  /nessus/i,
  /openvas/i,
  /acunetix/i,
  /burpsuite/i,

  // Misc crawlers
  /curl\//i,          // curl command line (suspicious if hitting API)
  /wget\//i,
  /python-requests/i,
  /axios\//i,         // Could be legitimate, but suspicious without proper UA
  /go-http-client/i,
  /java\//i,
  /libwww/i,
  /httpunit/i,
  /nutch/i,
  /biglotron/i,
  /teoma/i,
  /convera/i,
  /gigablast/i,
];

// Paths that bots commonly probe
const SUSPICIOUS_PATHS = [
  '/.well-known/',
  '/.env',
  '/wp-admin',
  '/wp-login',
  '/xmlrpc.php',
  '/admin',
  '/phpmyadmin',
  '/.git',
  '/config',
  '/backup',
  '/debug',
  '/test',
];

/**
 * Check if user agent matches known bot patterns
 */
function isBot(userAgent) {
  if (!userAgent) return true; // No UA = suspicious
  return BOT_PATTERNS.some(pattern => pattern.test(userAgent));
}

/**
 * Check if path is commonly probed by bots
 */
function isSuspiciousPath(path) {
  const lowerPath = path.toLowerCase();
  return SUSPICIOUS_PATHS.some(p => lowerPath.startsWith(p));
}

/**
 * Bot blocker middleware
 * Blocks requests from known bots and suspicious patterns
 */
export function botBlocker(req, res, next) {
  const userAgent = req.get('user-agent') || '';
  const path = req.path;

  // Allow robots.txt (so bots know they're not welcome)
  if (path === '/robots.txt') {
    return next();
  }

  // Allow health checks
  if (path === '/health' || path === '/api/health') {
    return next();
  }

  // Block suspicious paths immediately
  if (isSuspiciousPath(path)) {
    console.log(`[bot-blocker] Blocked suspicious path: ${path} from ${req.ip}`);
    return res.status(404).send('Not Found');
  }

  // Block known bots
  if (isBot(userAgent)) {
    console.log(`[bot-blocker] Blocked bot: "${userAgent.substring(0, 50)}..." from ${req.ip} on ${path}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Automated access is not permitted'
    });
  }

  next();
}

/**
 * Lightweight version - only blocks API routes, allows static assets
 */
export function apiOnlyBotBlocker(req, res, next) {
  // Only check /api routes
  if (!req.path.startsWith('/api')) {
    return next();
  }

  const userAgent = req.get('user-agent') || '';

  if (isBot(userAgent)) {
    console.log(`[bot-blocker] Blocked bot on API: "${userAgent.substring(0, 50)}..." from ${req.ip}`);
    return res.status(403).json({
      error: 'Access denied',
      message: 'Automated access to API is not permitted'
    });
  }

  next();
}

export default { botBlocker, apiOnlyBotBlocker };
