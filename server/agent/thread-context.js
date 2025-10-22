// server/agent/thread-context.js
// Thread-aware contextual memory for Agent/Assistant/Eidolon
// Provides conversation thread tracking and contextual awareness across sessions

import { memoryGet, memoryPut, memoryQuery } from "../eidolon/memory/pg.js";
import { v4 as uuidv4 } from "uuid";

const ASSISTANT_TABLE = "assistant_memory";
const EIDOLON_TABLE = "eidolon_memory";

/**
 * Thread Context Manager
 * Tracks conversation threads with full contextual awareness
 */
export class ThreadContextManager {
  constructor() {
    this.currentThreadId = null;
    this.threadMetadata = {};
  }

  /**
   * Initialize or resume a conversation thread
   */
  async initThread({ userId = "system", sessionId = null, parentThreadId = null }) {
    const threadId = uuidv4();
    this.currentThreadId = threadId;
    
    const threadData = {
      threadId,
      userId,
      sessionId: sessionId || uuidv4(),
      parentThreadId,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      context: {
        topics: [],
        entities: [],
        modelInteractions: [],
        keyDecisions: []
      }
    };

    // Store thread metadata
    await memoryPut({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      key: threadId,
      userId,
      content: threadData,
      ttlDays: 30
    });

    this.threadMetadata = threadData;
    return threadId;
  }

  /**
   * Resume existing thread with full context
   */
  async resumeThread(threadId, userId = "system") {
    const threadData = await memoryGet({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      key: threadId,
      userId
    });

    if (!threadData) {
      throw new Error(`Thread ${threadId} not found`);
    }

    this.currentThreadId = threadId;
    this.threadMetadata = threadData;
    return threadData;
  }

  /**
   * Add message to thread with automatic context enrichment and cross-thread storage
   */
  async addMessage({ role, content, modelProvider = null, metadata = {} }) {
    if (!this.currentThreadId) {
      throw new Error("No active thread. Call initThread() first");
    }

    const message = {
      id: uuidv4(),
      threadId: this.currentThreadId,
      role, // 'user', 'assistant', 'system', 'agent'
      content,
      modelProvider, // 'anthropic', 'openai', 'google', etc.
      timestamp: new Date().toISOString(),
      metadata
    };

    // Store message in thread-specific table
    await memoryPut({
      table: ASSISTANT_TABLE,
      scope: "thread_messages",
      key: `${this.currentThreadId}:${message.id}`,
      userId: this.threadMetadata.userId,
      content: message,
      ttlDays: 30
    });

    // Store in cross-thread memory for global context
    await memoryPut({
      table: "cross_thread_memory",
      scope: "all_threads",
      key: `global_msg_${message.id}`,
      userId: this.threadMetadata.userId,
      content: {
        ...message,
        originalThreadId: this.currentThreadId,
        threadContext: this.threadMetadata.context.topics.slice(-5)
      },
      ttlDays: 90
    });

    // Store agent memory if role is 'agent'
    if (role === "agent") {
      await memoryPut({
        table: "agent_memory",
        scope: "agent_actions",
        key: `agent_${message.id}`,
        userId: this.threadMetadata.userId,
        content: {
          action: content,
          threadId: this.currentThreadId,
          timestamp: message.timestamp,
          metadata
        },
        ttlDays: 365
      });
    }

    // Update thread metadata
    this.threadMetadata.messageCount++;
    this.threadMetadata.lastMessageAt = message.timestamp;

    // Auto-extract entities and topics from user messages
    if (role === "user") {
      await this._enrichContext(content);
    }

    // Track model interactions
    if (modelProvider) {
      this.threadMetadata.context.modelInteractions.push({
        provider: modelProvider,
        timestamp: message.timestamp,
        role
      });
    }

    // Persist updated metadata
    await memoryPut({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      key: this.currentThreadId,
      userId: this.threadMetadata.userId,
      content: this.threadMetadata,
      ttlDays: 30
    });

    return message;
  }

  /**
   * Get full thread context with all messages
   */
  async getThreadContext(threadId = null) {
    const tid = threadId || this.currentThreadId;
    if (!tid) {
      throw new Error("No thread ID provided");
    }

    // Get thread metadata
    const threadData = await memoryGet({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      key: tid,
      userId: this.threadMetadata?.userId || "system"
    });

    if (!threadData) {
      return null;
    }

    // Get all messages for this thread
    const messages = await memoryQuery({
      table: ASSISTANT_TABLE,
      scope: "thread_messages",
      userId: threadData.userId,
      limit: 200
    });

    // Filter messages for this thread and sort by timestamp
    const threadMessages = messages
      .filter(m => m.content.threadId === tid)
      .map(m => m.content)
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      ...threadData,
      messages: threadMessages,
      messageSummary: {
        total: threadMessages.length,
        byRole: this._countByRole(threadMessages),
        byProvider: this._countByProvider(threadMessages)
      }
    };
  }

  /**
   * Get recent threads with summaries
   */
  async getRecentThreads(userId = "system", limit = 10) {
    const threads = await memoryQuery({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      userId,
      limit
    });

    return threads.map(t => ({
      threadId: t.key,
      ...t.content,
      summary: this._generateThreadSummary(t.content)
    }));
  }

  /**
   * Add decision to thread context
   */
  async trackDecision({ decision, reasoning, impact, relatedTo = [] }) {
    if (!this.currentThreadId) return;

    const decisionRecord = {
      id: uuidv4(),
      decision,
      reasoning,
      impact,
      relatedTo,
      timestamp: new Date().toISOString()
    };

    this.threadMetadata.context.keyDecisions.push(decisionRecord);

    await memoryPut({
      table: EIDOLON_TABLE,
      scope: "conversation_threads",
      key: this.currentThreadId,
      userId: this.threadMetadata.userId,
      content: this.threadMetadata,
      ttlDays: 30
    });

    return decisionRecord;
  }

  /**
   * Extract topics and entities from user input (lightweight NLP)
   */
  async _enrichContext(content) {
    // Extract potential topics (capitalized phrases, technical terms)
    const topicPatterns = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const matches = content.match(topicPatterns) || [];
    
    const newTopics = [...new Set(matches)]
      .filter(t => t.length > 3 && !this.threadMetadata.context.topics.includes(t))
      .slice(0, 5);

    this.threadMetadata.context.topics.push(...newTopics);

    // Extract technical entities (model names, file paths, etc.)
    const entityPatterns = [
      /\b(gpt-[0-9a-z-]+)\b/gi,           // GPT models
      /\b(claude-[0-9a-z-]+)\b/gi,        // Claude models
      /\b(gemini-[0-9a-z-]+)\b/gi,        // Gemini models
      /\b([a-z-]+\.(js|ts|jsx|tsx|json|md))\b/gi, // File names
      /\b(server\/[a-z-/]+)\b/gi          // Server paths
    ];

    for (const pattern of entityPatterns) {
      const entities = content.match(pattern) || [];
      const uniqueEntities = [...new Set(entities.map(e => e.toLowerCase()))]
        .filter(e => !this.threadMetadata.context.entities.includes(e));
      
      this.threadMetadata.context.entities.push(...uniqueEntities);
    }

    // Keep only last 50 topics/entities
    this.threadMetadata.context.topics = this.threadMetadata.context.topics.slice(-50);
    this.threadMetadata.context.entities = this.threadMetadata.context.entities.slice(-50);
  }

  /**
   * Helper: Count messages by role
   */
  _countByRole(messages) {
    return messages.reduce((acc, m) => {
      acc[m.role] = (acc[m.role] || 0) + 1;
      return acc;
    }, {});
  }

  /**
   * Helper: Count messages by provider
   */
  _countByProvider(messages) {
    return messages.reduce((acc, m) => {
      if (m.modelProvider) {
        acc[m.modelProvider] = (acc[m.modelProvider] || 0) + 1;
      }
      return acc;
    }, {});
  }

  /**
   * Helper: Generate thread summary
   */
  _generateThreadSummary(threadData) {
    const { context, messageCount, startedAt } = threadData;
    const duration = new Date() - new Date(startedAt);
    const durationMins = Math.floor(duration / 60000);

    return {
      messageCount,
      durationMins,
      topicsDiscussed: context.topics.slice(0, 5),
      modelsUsed: [...new Set(context.modelInteractions.map(m => m.provider))],
      decisionsCount: context.keyDecisions.length
    };
  }
}

/**
 * Global thread manager instance
 */
let globalThreadManager = null;

export function getThreadManager() {
  if (!globalThreadManager) {
    globalThreadManager = new ThreadContextManager();
  }
  return globalThreadManager;
}

/**
 * Enhanced context with thread awareness and cross-thread memory
 */
export async function getThreadAwareContext(threadId = null) {
  const manager = getThreadManager();
  
  if (threadId) {
    await manager.resumeThread(threadId);
  }

  const threadContext = manager.currentThreadId 
    ? await manager.getThreadContext() 
    : null;

  const recentThreads = await manager.getRecentThreads("system", 5);

  // Get cross-thread memory
  const crossThreadMessages = await memoryQuery({
    table: "cross_thread_memory",
    scope: "all_threads",
    userId: "system",
    limit: 100
  });

  // Get agent memory
  const agentActions = await memoryQuery({
    table: "agent_memory",
    scope: "agent_actions",
    userId: "system",
    limit: 50
  });

  // Get Eidolon-specific memory
  const eidolonMemory = await memoryQuery({
    table: EIDOLON_TABLE,
    scope: "eidolon_context",
    userId: "system",
    limit: 50
  });

  return {
    currentThread: threadContext,
    recentThreads,
    threadAwareness: {
      hasActiveThread: !!manager.currentThreadId,
      currentThreadId: manager.currentThreadId,
      totalRecentThreads: recentThreads.length
    },
    crossThreadContext: {
      messages: crossThreadMessages.map(m => m.content),
      totalMessages: crossThreadMessages.length,
      threadPatterns: extractThreadPatterns(crossThreadMessages)
    },
    agentContext: {
      recentActions: agentActions.map(a => a.content),
      totalActions: agentActions.length
    },
    eidolonContext: {
      memory: eidolonMemory.map(e => e.content),
      totalEntries: eidolonMemory.length
    }
  };
}

/**
 * Extract patterns from cross-thread messages
 */
function extractThreadPatterns(messages) {
  const patterns = {
    commonTopics: new Map(),
    frequentThreads: new Map(),
    modelUsage: new Map()
  };

  messages.forEach(msg => {
    const content = msg.content;
    
    // Track thread frequency
    if (content.originalThreadId) {
      const count = patterns.frequentThreads.get(content.originalThreadId) || 0;
      patterns.frequentThreads.set(content.originalThreadId, count + 1);
    }

    // Track model usage
    if (content.modelProvider) {
      const count = patterns.modelUsage.get(content.modelProvider) || 0;
      patterns.modelUsage.set(content.modelProvider, count + 1);
    }

    // Track topics
    if (content.threadContext) {
      content.threadContext.forEach(topic => {
        const count = patterns.commonTopics.get(topic) || 0;
        patterns.commonTopics.set(topic, count + 1);
      });
    }
  });

  return {
    topTopics: Array.from(patterns.commonTopics.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([topic, count]) => ({ topic, count })),
    mostActiveThreads: Array.from(patterns.frequentThreads.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([threadId, count]) => ({ threadId, count })),
    modelDistribution: Array.from(patterns.modelUsage.entries())
      .map(([provider, count]) => ({ provider, count }))
  };
}
