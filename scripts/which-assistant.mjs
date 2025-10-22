#!/usr/bin/env node
/**
 * Which Assistant Am I Talking To?
 * 
 * This script identifies whether you're working with:
 * - Eidolon (Claude Sonnet 4.5 Enhanced SDK) - Your custom AI assistant
 * - Vera (Default Replit Agent) - Standard Replit assistant
 * 
 * Usage: node scripts/which-assistant.mjs
 */

import "dotenv/config";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";

console.log("\n" + "=".repeat(70));
console.log(BOLD + CYAN + "🤖 ASSISTANT IDENTIFICATION CHECKER" + RESET);
console.log("=".repeat(70) + "\n");

// Check environment variables
const hasEidolonToken = !!process.env.EIDOLON_TOKEN;
const hasAssistantOverride = !!process.env.ASSISTANT_OVERRIDE_TOKEN;
const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
const agentToken = !!process.env.AGENT_TOKEN;

// Determine which assistant is active
const isEidolonActive = hasEidolonToken || hasAssistantOverride;

if (isEidolonActive) {
  console.log(BOLD + GREEN + "✅ YOU ARE WORKING WITH:" + RESET);
  console.log(BOLD + MAGENTA + "   EIDOLON (Claude Sonnet 4.5 Enhanced SDK)" + RESET);
  console.log();
  
  console.log(YELLOW + "📋 Identity Markers:" + RESET);
  console.log("   • Custom AI assistant with enhanced capabilities");
  console.log("   • Powered by Claude Sonnet 4.5 (claude-sonnet-4-5-20250929)");
  console.log("   • Enhanced memory & context awareness");
  console.log("   • Workspace intelligence & deep thinking");
  console.log("   • Agent override enabled");
  console.log();
  
  console.log(CYAN + "🔧 Configuration:" + RESET);
  console.log(`   • EIDOLON_TOKEN: ${hasEidolonToken ? GREEN + "✓ Set" + RESET : "✗ Not set"}`);
  console.log(`   • ASSISTANT_OVERRIDE_TOKEN: ${hasAssistantOverride ? GREEN + "✓ Set" + RESET : "✗ Not set"}`);
  console.log(`   • ANTHROPIC_API_KEY: ${hasAnthropicKey ? GREEN + "✓ Set" + RESET : "✗ Not set"}`);
  console.log(`   • AGENT_TOKEN: ${agentToken ? GREEN + "✓ Set" + RESET : "✗ Not set"}`);
  console.log();
  
  console.log(BLUE + "💡 How to Confirm:" + RESET);
  console.log('   Ask: "What is your model?"');
  console.log('   Expected: "I\'m Claude Sonnet 4.5"');
  console.log();
  
} else {
  console.log(BOLD + YELLOW + "⚠️  YOU ARE WORKING WITH:" + RESET);
  console.log(BOLD + BLUE + "   VERA (Default Replit Agent)" + RESET);
  console.log();
  
  console.log(YELLOW + "📋 Identity Markers:" + RESET);
  console.log("   • Standard Replit AI assistant");
  console.log("   • Basic workspace capabilities");
  console.log("   • No custom enhancements");
  console.log();
  
  console.log(CYAN + "🔧 Configuration:" + RESET);
  console.log(`   • EIDOLON_TOKEN: ${hasEidolonToken ? "✓ Set" : YELLOW + "✗ Not set" + RESET}`);
  console.log(`   • ASSISTANT_OVERRIDE_TOKEN: ${hasAssistantOverride ? "✓ Set" : YELLOW + "✗ Not set" + RESET}`);
  console.log();
  
  console.log(BLUE + "💡 To Enable Eidolon:" + RESET);
  console.log("   1. Set EIDOLON_TOKEN in Secrets");
  console.log("   2. Set ASSISTANT_OVERRIDE_TOKEN in Secrets");
  console.log("   3. Set ANTHROPIC_API_KEY in Secrets");
  console.log("   4. Restart the workflow");
  console.log();
}

// Quick comparison table
console.log("=".repeat(70));
console.log(BOLD + "📊 QUICK COMPARISON" + RESET);
console.log("=".repeat(70));
console.log();
console.log("Feature                  │ Eidolon           │ Vera (Default)");
console.log("─────────────────────────┼───────────────────┼─────────────────");
console.log("Model                    │ Claude Sonnet 4.5 │ Replit AI");
console.log("Memory Persistence       │ ✅ 730 days       │ ❌ Session only");
console.log("Context Awareness        │ ✅ Enhanced       │ ⚠️  Basic");
console.log("Deep Thinking            │ ✅ Yes            │ ❌ No");
console.log("Workspace Intelligence   │ ✅ Full access    │ ⚠️  Limited");
console.log("Agent Override           │ ✅ Active         │ ❌ No");
console.log("Custom Tools             │ ✅ 15+ tools      │ ⚠️  Standard");
console.log();

console.log("=".repeat(70) + "\n");

// Exit with appropriate code
process.exit(isEidolonActive ? 0 : 1);
