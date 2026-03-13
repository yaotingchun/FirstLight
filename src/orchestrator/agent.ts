/**
 *  agent.ts — The core AI Orchestrator Agent
 *
 *  Uses Google Vertex AI (Gemini) directly to read the environment
 *  snapshot and decide what actions the drone swarm should take.
 */

import { createModel } from './vertexClient.js';
import { SYSTEM_PROMPT, buildUserPrompt } from './prompts.js';
import type { EnvironmentSnapshot, OrchestratorDecision } from './types.js';

/** Initialise the Gemini model once — reuse across ticks */
const model = createModel(0.2);

/**
 * Parse the AI's raw text response into a typed OrchestratorDecision.
 * Handles edge cases like markdown fences, trailing commas, etc.
 */
const parseDecision = (raw: string): OrchestratorDecision => {
    // Strip markdown code fences if the model wraps them
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned);

        // Validate required fields
        if (!parsed.reasoning || !Array.isArray(parsed.actions)) {
            throw new Error('Missing required fields: reasoning, actions');
        }

        return {
            reasoning: parsed.reasoning,
            priority: parsed.priority ?? 'medium',
            actions: parsed.actions,
        };
    } catch (err) {
        console.error('[Agent] Failed to parse AI response:', err);
        console.error('[Agent] Raw response:', raw);

        // Return a safe fallback
        return {
            reasoning: `Parse error — raw output preserved for debugging: ${raw.slice(0, 200)}`,
            priority: 'low',
            actions: [{ type: 'no_action', reason: 'AI response could not be parsed.' }],
        };
    }
};

/**
 * Run one decision cycle of the AI orchestrator.
 *
 * @param snapshot  Current environment state
 * @returns         Structured decision with reasoning and actions
 */
export const decideActions = async (
    snapshot: EnvironmentSnapshot,
): Promise<OrchestratorDecision> => {
    const userPrompt = buildUserPrompt(snapshot);

    console.log(`\n[Agent] ──── Tick #${snapshot.tickNumber} ────`);
    console.log(`[Agent] ${snapshot.drones.length} drones total, ${snapshot.activeDrones} active, Scanned: ${snapshot.scannedCells}/${snapshot.totalCells}, Avg prob: ${snapshot.averageProbability}`);

    const startTime = Date.now();

    const result = await model.generateContent({
        systemInstruction: { role: 'system', parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    });

    const elapsed = Date.now() - startTime;
    const content = result.response.candidates?.[0]?.content?.parts?.[0]?.text ?? '';

    console.log(`[Agent] Gemini responded in ${elapsed}ms`);

    const decision = parseDecision(content);

    console.log(`[Agent] Priority: ${decision.priority}`);
    console.log(`[Agent] Reasoning: ${decision.reasoning}`);
    console.log(`[Agent] Actions (${decision.actions.length}):`);
    for (const action of decision.actions) {
        const detail = action.type === 'move_drone' ? ` ${action.droneId} → (${action.x},${action.y})` : '';
        const reason = 'reason' in action ? action.reason : ('message' in action ? action.message : '');
        console.log(`  → ${action.type}${detail} — ${reason}`);
    }

    return decision;
};

export default decideActions;
