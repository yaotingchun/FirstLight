import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VertexAI } from '@google-cloud/vertexai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface CandidateInsight {
    insight: string;
    conditions: string;
    recommendation: string;
    expected_impact: string;
    confidence: number;
}

export interface StoredInsight extends CandidateInsight {
    id: string;
    timestamp: number;
    embedding?: number[];
}

const KNOWLEDGE_BASE_PATH = path.resolve(__dirname, '../../../data/knowledge_base.json');

// Ensure knowledge base file exists
function initializeStore() {
    const dir = path.dirname(KNOWLEDGE_BASE_PATH);
    if (!fsSync.existsSync(dir)) fsSync.mkdirSync(dir, { recursive: true });
    if (!fsSync.existsSync(KNOWLEDGE_BASE_PATH)) {
        fsSync.writeFileSync(KNOWLEDGE_BASE_PATH, '[]', 'utf8');
    }
}

export class RAGService {
    private vertexAI: VertexAI | null = null;
    private embeddingModelName = 'text-embedding-004';
    private writeLock: Promise<void> = Promise.resolve();

    constructor() {
        initializeStore();
        try {
            const project = process.env.GOOGLE_VERTEX_PROJECT;
            const location = process.env.GOOGLE_VERTEX_LOCATION || 'us-central1';
            
            // Only initialize if project exists
            if (project) {
                this.vertexAI = new VertexAI({ project, location });
            }
        } catch (e) {
            console.error('[RAG] Failed to initialize VertexAI for embeddings:', e);
        }
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        if (!this.vertexAI) {
            console.warn('[RAG] Vertex AI not initialized, skipping embedding.');
            return [];
        }

        try {
            const model = this.vertexAI.getGenerativeModel({ model: this.embeddingModelName });
            // For Vertex AI, calling embedContent returns { embedding: { values: number[] } }
            const resp = await model.embedContent(text);
            const embedding = resp.embedding?.values;
            return embedding || [];
        } catch (e) {
            console.error('[RAG] Failed to generate embedding:', e);
            return [];
        }
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA.length || !vecB.length) return 0;
        if (vecA.length !== vecB.length) return 0;

        let dotProduct = 0, normA = 0, normB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] ** 2;
            normB += vecB[i] ** 2;
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    public async saveInsights(insights: CandidateInsight[]) {
        // Use a write lock to prevent race conditions during concurrent saves
        this.writeLock = this.writeLock.then(async () => {
            try {
                const raw = await fs.readFile(KNOWLEDGE_BASE_PATH, 'utf8');
                let records: StoredInsight[] = [];
                try { records = JSON.parse(raw); } catch (e) { records = []; }

                for (const insight of insights) {
                    const textToEmbed = `Insight: ${insight.insight}\nConditions: ${insight.conditions}`;
                    const embedding = await this.generateEmbedding(textToEmbed);

                    records.push({
                        ...insight,
                        id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7),
                        timestamp: Date.now(),
                        embedding: embedding.length > 0 ? embedding : undefined
                    });
                }

                await fs.writeFile(KNOWLEDGE_BASE_PATH, JSON.stringify(records, null, 2), 'utf8');
                console.log(`[RAG] Saved ${insights.length} candidate insights to Knowledge Base.`);
            } catch (err) {
                console.error('[RAG] Error saving insights:', err);
            }
        });

        return this.writeLock;
    }

    public async retrieveRelevantInsights(simulationSummaryText: string, topK: number = 3): Promise<StoredInsight[]> {
        const queryEmbedding = await this.generateEmbedding(simulationSummaryText);
        
        let records: StoredInsight[] = [];
        try {
            const raw = await fs.readFile(KNOWLEDGE_BASE_PATH, 'utf8');
            records = JSON.parse(raw);
        } catch (e) {
            records = [];
        }

        if (!queryEmbedding.length || records.length === 0) {
            // Fallback: If embeddings fail or no records exist, return most recent
            return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, topK);
        }

        const scored = records.map(record => {
            let score = 0;
            if (record.embedding && record.embedding.length > 0) {
                score = this.cosineSimilarity(queryEmbedding, record.embedding);
            }
            return { record, score };
        });

        const valid = scored.filter(s => s.score > 0)
                            .sort((a, b) => b.score - a.score);

        if (valid.length === 0) {
             return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, topK);
        }

        return valid.slice(0, topK).map(s => s.record);
    }
}

export const ragService = new RAGService();
