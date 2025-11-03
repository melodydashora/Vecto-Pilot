// server/routes/content-blocks.js
// Structured content blocks for rich strategy display

import { Router } from 'express';
import { db } from '../db/drizzle.js';
import { strategies, snapshots } from '../../shared/schema.js';
import { eq } from 'drizzle-orm';

export const router = Router();

/**
 * GET /api/blocks/strategy/:snapshotId
 * Returns structured content blocks for a strategy
 */
router.get('/strategy/:snapshotId', async (req, res) => {
  const { snapshotId } = req.params;
  
  try {
    console.log(`[content-blocks] Fetching blocks for snapshot ${snapshotId}`);
    
    // Fetch strategy and snapshot data
    const [strategy] = await db.select()
      .from(strategies)
      .where(eq(strategies.snapshot_id, snapshotId))
      .limit(1);
    
    if (!strategy) {
      return res.status(404).json({ 
        error: 'strategy_not_found',
        snapshot_id: snapshotId 
      });
    }
    
    const [snapshot] = await db.select()
      .from(snapshots)
      .where(eq(snapshots.snapshot_id, snapshotId))
      .limit(1);
    
    // Generate structured blocks from strategy content
    const blocks = generateBlocks(strategy, snapshot);
    
    res.json({
      snapshot_id: snapshotId,
      blocks
    });
  } catch (error) {
    console.error(`[content-blocks] Error:`, error);
    res.status(500).json({ 
      error: 'internal_error', 
      message: error.message 
    });
  }
});

/**
 * Generate structured blocks from strategy and snapshot data
 */
function generateBlocks(strategy, snapshot) {
  const blocks = [];
  let order = 1;
  
  // If strategy has consolidated text, parse it into blocks
  if (strategy.consolidated_strategy) {
    const text = strategy.consolidated_strategy;
    
    // Add header
    const hour = snapshot?.hour || new Date().getHours();
    const dayPart = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
    
    blocks.push({
      id: `b${order++}`,
      type: 'header',
      order: blocks.length + 1,
      text: `${dayPart} Strategy`,
      level: 2
    });
    
    // Split strategy text into paragraphs
    const paragraphs = text.split('\n\n').filter(p => p.trim().length > 0);
    
    paragraphs.forEach(para => {
      const trimmed = para.trim();
      
      // Check if it's a list (starts with bullet points or numbers)
      if (trimmed.match(/^[-•*]\s/) || trimmed.match(/^\d+\.\s/)) {
        const items = trimmed
          .split('\n')
          .map(line => line.replace(/^[-•*]\s/, '').replace(/^\d+\.\s/, '').trim())
          .filter(item => item.length > 0);
        
        blocks.push({
          id: `b${order++}`,
          type: 'list',
          order: blocks.length + 1,
          items,
          style: trimmed.match(/^\d+\.\s/) ? 'number' : 'bullet'
        });
      } else {
        // Regular paragraph
        blocks.push({
          id: `b${order++}`,
          type: 'paragraph',
          order: blocks.length + 1,
          text: trimmed
        });
      }
    });
  } else {
    // No strategy yet - return placeholder blocks
    blocks.push({
      id: `b${order++}`,
      type: 'header',
      order: blocks.length + 1,
      text: 'Strategy Generating...',
      level: 2
    });
    
    blocks.push({
      id: `b${order++}`,
      type: 'paragraph',
      order: blocks.length + 1,
      text: 'Your AI-powered strategy is being generated. This typically takes 10-30 seconds.'
    });
  }
  
  return blocks;
}

export default router;
