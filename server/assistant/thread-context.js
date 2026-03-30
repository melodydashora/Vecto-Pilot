
// server/assistant/thread-context.js
// Thread-aware contextual memory for Assistant
// Extends agent thread-context with assistant-specific features

import { memoryGet, memoryPut, memoryQuery } from "../eidolon/memory/pg.js";
import { v4 as uuidv4 } from "uuid";

const ASSISTANT_TABLE = "assistant_memory";
const CROSS_THREAD_TABLE = "cross_thread_memory";

export class AssistantThreadManager {
  constructor() {
    this.currentThreadId = null;
    this.threadMetadata = {};
    this.identity = "assistant";
  }

  async initThread({ userId = "assistant", sessionId = null, parentThreadId = null }) {
    const threadId = uuidv4();
    this.currentThreadId = threadId;
    
    const threadData = {
      threadId,
      userId,
      sessionId: sessionId || uuidv4(),
      parentThreadId,
      identity: this.identity,
      startedAt: new Date().toISOString(),
      messageCount: 0,
      context: {
        topics: [],
        entities: [],
        modelInteractions: [],
        keyDecisions: [],
        assistantActions: []
      }
    };

    await memoryPut({
      table: ASSISTANT_TABLE,
      scope: "conversation_threads",
      key: threadId,
      userId,
      content: threadData,
      ttlDays: 90
    });

    this.threadMetadata = threadData;
    return threadId;
  }

  async addMessage({ role, content, modelProvider = null, metadata = {} }) {
    if (!this.currentThreadId) {
      await this.initThread({});
    }

    const message = {
      id: uuidv4(),
      threadId: this.currentThreadId,
      role,
      content,
      modelProvider,
      timestamp: new Date().toISOString(),
      metadata,
      identity: this.identity
    };

    await memoryPut({
      table: ASSISTANT_TABLE,
      scope: "thread_messages",
      key: `${this.currentThreadId}:${message.id}`,
      userId: this.threadMetadata.userId,
      content: message,
      ttlDays: 90
    });

    // Store in cross-thread memory
    await memoryPut({
      table: CROSS_THREAD_TABLE,
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

    this.threadMetadata.messageCount++;
    this.threadMetadata.lastMessageAt = message.timestamp;

    if (role === "user") {
      await this._enrichContext(content);
    }

    if (modelProvider) {
      this.threadMetadata.context.modelInteractions.push({
        provider: modelProvider,
        timestamp: message.timestamp,
        role
      });
    }

    await memoryPut({
      table: ASSISTANT_TABLE,
      scope: "conversation_threads",
      key: this.currentThreadId,
      userId: this.threadMetadata.userId,
      content: this.threadMetadata,
      ttlDays: 90
    });

    return message;
  }

  async _enrichContext(content) {
    const topicPatterns = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g;
    const matches = content.match(topicPatterns) || [];
    
    const newTopics = [...new Set(matches)]
      .filter(t => t.length > 3 && !this.threadMetadata.context.topics.includes(t))
      .slice(0, 5);

    this.threadMetadata.context.topics.push(...newTopics);
    this.threadMetadata.context.topics = this.threadMetadata.context.topics.slice(-50);
  }
}

let globalAssistantThreadManager = null;

export function getAssistantThreadManager() {
  if (!globalAssistantThreadManager) {
    globalAssistantThreadManager = new AssistantThreadManager();
  }
  return globalAssistantThreadManager;
}
