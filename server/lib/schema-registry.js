
// Vecto Pilot™ Schema Registry
// Centralized schema definitions for AI model outputs

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Schema definitions
export const SCHEMAS = {
  gpt5_tactical_plan: {
    name: 'GPT-5 Tactical Plan',
    path: path.resolve(__dirname, '../../schema/plan.schema.json'),
    description: 'Structured output format for GPT-5 tactical planning with blocks and pro tips',
    required_by: ['triad_planner'],
    version: '1.0.0'
  }
};

// Load schema from file
export function loadSchema(schemaKey) {
  const schema = SCHEMAS[schemaKey];
  if (!schema) {
    throw new Error(`Schema not found: ${schemaKey}`);
  }
  
  try {
    const schemaContent = fs.readFileSync(schema.path, 'utf-8');
    return JSON.parse(schemaContent);
  } catch (error) {
    throw new Error(`Failed to load schema ${schemaKey}: ${error.message}`);
  }
}

// Validate data against schema (basic validation)
export function validateAgainstSchema(data, schemaKey) {
  const schema = loadSchema(schemaKey);
  
  // Basic validation - check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in data)) {
        return {
          valid: false,
          error: `Missing required field: ${field}`
        };
      }
    }
  }
  
  return { valid: true };
}

// Get schema for a specific model
export function getSchemaForModel(modelKey) {
  for (const [schemaKey, schema] of Object.entries(SCHEMAS)) {
    if (schema.required_by && schema.required_by.includes(modelKey)) {
      return loadSchema(schemaKey);
    }
  }
  return null;
}

export default {
  SCHEMAS,
  loadSchema,
  validateAgainstSchema,
  getSchemaForModel
};
