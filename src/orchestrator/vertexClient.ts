/**
 *  vertexClient.ts — Google Vertex AI (Gemini) via @google-cloud/vertexai
 *
 *  Initialises the Vertex AI client using GOOGLE_APPLICATION_CREDENTIALS
 *  and project settings from .env.  Exports a ready-to-use GenerativeModel.
 */

import { VertexAI, type GenerativeModel } from '@google-cloud/vertexai';
import dotenv from 'dotenv';

dotenv.config();

// Validate required env vars
const required = ['GOOGLE_APPLICATION_CREDENTIALS', 'GOOGLE_VERTEX_PROJECT', 'GOOGLE_VERTEX_LOCATION'] as const;
for (const key of required) {
    if (!process.env[key]) {
        throw new Error(`Missing required environment variable: ${key}`);
    }
}

/** Singleton Vertex AI client */
const vertexAI = new VertexAI({
    project: process.env.GOOGLE_VERTEX_PROJECT!,
    location: process.env.GOOGLE_VERTEX_LOCATION!,
});

/**
 * Create a GenerativeModel instance configured for the FirstLight orchestrator.
 * Uses Gemini model specified in .env (defaults to gemini-2.0-flash).
 */
export const createModel = (temperature = 0.2): GenerativeModel => {
    return vertexAI.getGenerativeModel({
        model: process.env.ORCHESTRATOR_MODEL ?? 'gemini-2.0-flash',
        generationConfig: {
            temperature,
            maxOutputTokens: 8192,
            responseMimeType: 'application/json',
        },
    });
};

/**
 * Create a model for chat mode — no forced JSON, allows natural text responses.
 */
export const createChatModel = (temperature = 0.3): GenerativeModel => {
    return vertexAI.getGenerativeModel({
        model: process.env.ORCHESTRATOR_MODEL ?? 'gemini-2.5-flash',
        generationConfig: {
            temperature,
            maxOutputTokens: 8192,
        },
    });
};

export { vertexAI };
export default createModel;
