/**
 * Network Manager
 * 
 * Manages relay mesh network topology, self-healing, multi-hop routing,
 * and offline data buffering.
 * 
 * Mirrors the BFS connectivity logic from SimulationMapMCP.tsx and
 * communicationTools.ts but adds relay-chain awareness, hop counting,
 * link quality assessment, and delay-tolerant networking.
 */

import type {
    DroneStatus,
    NetworkTopology,
    NetworkLink,
} from '../types.js';
import { gridToLabel, BASE_X, BASE_Y, GRID_W, GRID_H } from '../droneStore.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS (must match SimulationMapMCP.tsx and communicationTools.ts)
// ═══════════════════════════════════════════════════════════════════════════

const COMM_RANGE_DRONE = 5;
const COMM_RANGE_RELAY = 10;
const COMM_RANGE_BASE = 12;

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK NODE TYPE
// ═══════════════════════════════════════════════════════════════════════════

interface NetworkNode {
    id: string;
    x: number;
    y: number;
    isRelay: boolean;
    isBase: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// NETWORK MANAGER CLASS
// ═══════════════════════════════════════════════════════════════════════════

export class NetworkManager {
    /** Buffered data when base is disconnected (bytes, simulated) */
    private offlineBuffer: Array<{
        timestamp: number;
        dataType: string;
        payload: unknown;
        sizeBytes: number;
    }> = [];

    /** Previous topology for detecting failures */
    private previousRelayIds: Set<string> = new Set();

    /**
     * Build the full network topology from current drone states.
     * Runs BFS from base, computes hop counts, link quality, and relay chain.
     */
    buildTopology(drones: DroneStatus[]): NetworkTopology {
        const baseNode: NetworkNode = {
            id: 'BASE',
            x: BASE_X,
            y: BASE_Y,
            isRelay: false,
            isBase: true,
        };

        const droneNodes: NetworkNode[] = drones
            .filter(d => d.isActive)
            .map(d => ({
                id: d.id,
                x: d.position.x,
                y: d.position.y,
                isRelay: d.mode === 'Relay',
                isBase: false,
            }));

        const allNodes = [baseNode, ...droneNodes];
        const nodeMap = new Map<string, NetworkNode>();
        allNodes.forEach(n => nodeMap.set(n.id, n));

        // Build adjacency
        const adj = new Map<string, string[]>();
        allNodes.forEach(n => adj.set(n.id, []));
        const rawLinks: Array<{ source: string; target: string; distance: number }> = [];

        for (let i = 0; i < allNodes.length; i++) {
            for (let j = i + 1; j < allNodes.length; j++) {
                const n1 = allNodes[i];
                const n2 = allNodes[j];
                const dist = Math.sqrt(
                    Math.pow(n1.x - n2.x, 2) + Math.pow(n1.y - n2.y, 2)
                );

                const range1 = n1.isBase ? COMM_RANGE_BASE :
                    n1.isRelay ? COMM_RANGE_RELAY : COMM_RANGE_DRONE;
                const range2 = n2.isBase ? COMM_RANGE_BASE :
                    n2.isRelay ? COMM_RANGE_RELAY : COMM_RANGE_DRONE;

                if (dist <= Math.max(range1, range2)) {
                    adj.get(n1.id)!.push(n2.id);
                    adj.get(n2.id)!.push(n1.id);
                    rawLinks.push({ source: n1.id, target: n2.id, distance: dist });
                }
            }
        }

        // BFS from base
        const visited = new Set<string>();
        const parent = new Map<string, string>();
        const hopCount = new Map<string, number>();
        const queue: string[] = ['BASE'];
        visited.add('BASE');
        hopCount.set('BASE', 0);

        while (queue.length > 0) {
            const curr = queue.shift()!;
            const neighbors = adj.get(curr) || [];
            for (const nxt of neighbors) {
                if (!visited.has(nxt)) {
                    visited.add(nxt);
                    parent.set(nxt, curr);
                    hopCount.set(nxt, (hopCount.get(curr) ?? 0) + 1);
                    queue.push(nxt);
                }
            }
        }

        // Build links with quality and hop count
        const links: NetworkLink[] = rawLinks.map(rl => {
            const n1 = nodeMap.get(rl.source)!;
            const n2 = nodeMap.get(rl.target)!;
            const range1 = n1.isBase ? COMM_RANGE_BASE :
                n1.isRelay ? COMM_RANGE_RELAY : COMM_RANGE_DRONE;
            const range2 = n2.isBase ? COMM_RANGE_BASE :
                n2.isRelay ? COMM_RANGE_RELAY : COMM_RANGE_DRONE;
            const effectiveRange = Math.max(range1, range2);
            const quality = Math.max(0, Math.round((1 - rl.distance / effectiveRange) * 100) / 100);

            return {
                source: rl.source,
                target: rl.target,
                quality,
                hopCount: Math.min(
                    hopCount.get(rl.source) ?? 99,
                    hopCount.get(rl.target) ?? 99
                ),
            };
        });

        // Identify connected / disconnected
        const connectedDrones = drones
            .filter(d => d.isActive && visited.has(d.id))
            .map(d => d.id);
        const disconnectedDrones = drones
            .filter(d => d.isActive && !visited.has(d.id))
            .map(d => d.id);

        // Build relay chain (path from base through relays)
        const relayChain = this.buildRelayChain(drones, parent);

        // Check if base is reachable
        const isBaseConnected = visited.has('BASE');

        // Track relays for failure detection
        const currentRelayIds = new Set(
            drones.filter(d => d.isActive && d.mode === 'Relay').map(d => d.id)
        );
        this.previousRelayIds = currentRelayIds;

        // Hop counts for all drones
        const hopCounts = drones
            .filter(d => d.isActive)
            .map(d => ({
                droneId: d.id,
                hops: hopCount.get(d.id) ?? -1,
            }));

        return {
            relayChain,
            links,
            connectedDrones,
            disconnectedDrones,
            hopCounts,
            isBaseConnected,
            bufferedDataSize: this.getBufferedDataSize(),
        };
    }

    /**
     * Build an ordered relay chain from base through relays.
     * E.g., ["BASE", "R1", "R2"]
     */
    private buildRelayChain(
        drones: DroneStatus[],
        parent: Map<string, string>
    ): string[] {
        const relays = drones.filter(d => d.isActive && d.mode === 'Relay');
        if (relays.length === 0) return ['BASE'];

        // Find relay closest to base (first hop)
        const chain: string[] = ['BASE'];
        const used = new Set<string>();

        let current = 'BASE';
        for (let i = 0; i < relays.length; i++) {
            // Find nearest unused relay connected to current
            let nearest: DroneStatus | null = null;
            let minDist = Infinity;

            for (const relay of relays) {
                if (used.has(relay.id)) continue;

                // Check if this relay has a path back through the parent chain
                let node = relay.id;
                let connected = false;
                while (parent.has(node)) {
                    if (parent.get(node) === current) {
                        connected = true;
                        break;
                    }
                    node = parent.get(node)!;
                }

                if (connected) {
                    const pos = relay.position;
                    const refNode = current === 'BASE'
                        ? { x: BASE_X, y: BASE_Y }
                        : relays.find(r => r.id === current)?.position ?? { x: BASE_X, y: BASE_Y };
                    const dist = Math.sqrt(
                        Math.pow(pos.x - refNode.x, 2) +
                        Math.pow(pos.y - refNode.y, 2)
                    );
                    if (dist < minDist) {
                        minDist = dist;
                        nearest = relay;
                    }
                }
            }

            if (nearest) {
                chain.push(nearest.id);
                used.add(nearest.id);
                current = nearest.id;
            }
        }

        return chain;
    }

    /**
     * Detect relay failures: relays that were in the previous topology
     * but are no longer present.
     */
    detectRelayFailures(currentDrones: DroneStatus[]): string[] {
        const currentRelayIds = new Set(
            currentDrones.filter(d => d.isActive && d.mode === 'Relay').map(d => d.id)
        );

        const failed: string[] = [];
        for (const prevId of this.previousRelayIds) {
            if (!currentRelayIds.has(prevId)) {
                failed.push(prevId);
            }
        }

        return failed;
    }

    // ─────────────────────────────────────────────────────────────────────
    // OFFLINE BUFFERING (Delay-Tolerant Networking)
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Buffer data when base connection is lost.
     */
    bufferData(dataType: string, payload: unknown, timestamp: number): void {
        const serialized = JSON.stringify(payload);
        this.offlineBuffer.push({
            timestamp,
            dataType,
            payload,
            sizeBytes: serialized.length,
        });

        // Cap buffer at 1000 entries
        if (this.offlineBuffer.length > 1000) {
            this.offlineBuffer = this.offlineBuffer.slice(-1000);
        }
    }

    /**
     * Flush the offline buffer (called when base reconnects).
     * Returns all buffered data and clears the buffer.
     */
    flushBuffer(): Array<{ timestamp: number; dataType: string; payload: unknown }> {
        const data = this.offlineBuffer.map(({ timestamp, dataType, payload }) => ({
            timestamp,
            dataType,
            payload,
        }));
        this.offlineBuffer = [];
        return data;
    }

    /**
     * Get total buffered data size in bytes.
     */
    getBufferedDataSize(): number {
        return this.offlineBuffer.reduce((sum, entry) => sum + entry.sizeBytes, 0);
    }

    /**
     * Check if there is buffered data waiting to sync.
     */
    hasBufferedData(): boolean {
        return this.offlineBuffer.length > 0;
    }

    /**
     * Reset the manager state.
     */
    reset(): void {
        this.offlineBuffer = [];
        this.previousRelayIds = new Set();
    }
}

// Singleton export
export const networkManager = new NetworkManager();
