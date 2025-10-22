// server/lib/semantic-search.js
// Semantic search capabilities using vector embeddings
import { knnSearch, upsertDoc } from '../../gateway-server.js';
import { db } from '../db/drizzle.js';
import { snapshots, strategies, rankings, venue_feedback } from '../../shared/schema.js';
import { eq, desc } from 'drizzle-orm';

/**
 * Generate embedding using OpenAI (or fallback to simple hash for MVP)
 * TODO: Integrate with actual OpenAI text-embedding-3-small when budget allows
 */
async function generateEmbedding(text) {
  // For MVP: Use deterministic feature vector from text characteristics
  // This allows the infrastructure to work; replace with real embeddings later
  const features = new Array(1536).fill(0);
  
  // Simple feature extraction (replace with OpenAI later)
  const words = text.toLowerCase().split(/\s+/);
  const wordCount = words.length;
  const avgWordLen = words.reduce((sum, w) => sum + w.length, 0) / wordCount;
  const uniqueWords = new Set(words).size;
  
  features[0] = Math.min(wordCount / 1000, 1.0); // Normalized word count
  features[1] = Math.min(avgWordLen / 20, 1.0); // Normalized avg word length
  features[2] = uniqueWords / wordCount; // Vocabulary diversity
  
  // Hash-based features for the rest
  for (let i = 3; i < 1536; i++) {
    const hash = text.charCodeAt(i % text.length) || 0;
    features[i] = (hash % 256) / 255.0;
  }
  
  return features;
}

/**
 * Index a strategy for semantic search
 */
export async function indexStrategy(strategyId, snapshotId) {
  try {
    const [strategy] = await db
      .select()
      .from(strategies)
      .where(eq(strategies.id, strategyId))
      .limit(1);
    
    if (!strategy || !strategy.strategy) return null;
    
    const content = typeof strategy.strategy === 'string' 
      ? strategy.strategy 
      : JSON.stringify(strategy.strategy);
    
    const embedding = await generateEmbedding(content);
    
    await upsertDoc({
      id: `strategy:${strategyId}`,
      content,
      metadata: {
        type: 'strategy',
        strategy_id: strategyId,
        snapshot_id: snapshotId,
        status: strategy.status,
        created_at: strategy.created_at.toISOString()
      },
      embedding
    });
    
    console.log('[semantic] Indexed strategy:', strategyId);
    return strategyId;
  } catch (err) {
    console.error('[semantic] Failed to index strategy:', err.message);
    return null;
  }
}

/**
 * Index venue feedback for semantic analysis
 */
export async function indexFeedback(feedbackId) {
  try {
    const [feedback] = await db
      .select()
      .from(venue_feedback)
      .where(eq(venue_feedback.id, feedbackId))
      .limit(1);
    
    if (!feedback) return null;
    
    const content = [
      feedback.venue_name,
      feedback.sentiment,
      feedback.comment || ''
    ].join(' ');
    
    const embedding = await generateEmbedding(content);
    
    await upsertDoc({
      id: `feedback:${feedbackId}`,
      content,
      metadata: {
        type: 'venue_feedback',
        feedback_id: feedbackId,
        venue_name: feedback.venue_name,
        place_id: feedback.place_id,
        sentiment: feedback.sentiment,
        ranking_id: feedback.ranking_id,
        created_at: feedback.created_at.toISOString()
      },
      embedding
    });
    
    console.log('[semantic] Indexed feedback:', feedbackId);
    return feedbackId;
  } catch (err) {
    console.error('[semantic] Failed to index feedback:', err.message);
    return null;
  }
}

/**
 * Find similar strategies based on semantic similarity
 */
export async function findSimilarStrategies(queryText, k = 5, minScore = 0.7) {
  try {
    const queryEmbedding = await generateEmbedding(queryText);
    const results = await knnSearch({ queryEmbedding, k, minScore });
    
    // Filter for strategies only
    const strategies = results.filter(r => r.metadata?.type === 'strategy');
    
    console.log('[semantic] Found similar strategies:', strategies.length);
    return strategies;
  } catch (err) {
    console.error('[semantic] Similarity search failed:', err.message);
    return [];
  }
}

/**
 * Find similar feedback patterns
 */
export async function findSimilarFeedback(queryText, k = 10, minScore = 0.6) {
  try {
    const queryEmbedding = await generateEmbedding(queryText);
    const results = await knnSearch({ queryEmbedding, k, minScore });
    
    // Filter for feedback only
    const feedback = results.filter(r => r.metadata?.type === 'venue_feedback');
    
    console.log('[semantic] Found similar feedback:', feedback.length);
    return feedback;
  } catch (err) {
    console.error('[semantic] Feedback search failed:', err.message);
    return [];
  }
}

export { generateEmbedding };
