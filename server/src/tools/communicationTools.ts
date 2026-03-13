/**
 * COMMUNICATION MODULE - MCP Tools
 * 
 * Tools for observing the mesh communication network.
 * 
 * DESIGN RATIONALE:
 * - getCommNetworkStatus: OBSERVATION - AI needs to understand drone connectivity
 * - getDisconnectedDrones: OBSERVATION - AI needs to know which drones are offline
 * 
 * NOT EXPOSED (remain internal algorithms):
 * - BFS connectivity calculation: Internal graph algorithm
 * - Relay positioning optimization: Automatic swarm behavior
 * - Communication range physics: Hardware constraint, not AI-controllable
 */

import { droneStore, BASE_X, BASE_Y, gridToLabel } from '../droneStore.js';
import type { 
    CommNetworkStatus, 
    CommLink,
    DroneStatus,
    MCPToolResult 
} from '../types.js';

// Communication range constants (from simulation)
const COMM_RANGE_DRONE = 5;
const COMM_RANGE_RELAY = 10;
const COMM_RANGE_BASE = 12;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Build mesh network graph and run BFS
// ═══════════════════════════════════════════════════════════════════════════

interface NetworkNode {
    id: string;
    x: number;
    y: number;
    mode?: string;
}

/**
 * Build adjacency graph using the same logic as SimulationMap.tsx
 * Connection exists if dist <= Math.max(range1, range2)
 */
function buildMeshNetwork(drones: DroneStatus[]): {
    adj: Map<string, string[]>;
    links: Array<{ source: string; target: string }>;
    nodeMap: Map<string, NetworkNode>;
} {
    const nodes: NetworkNode[] = [
        { id: 'BASE', x: BASE_X, y: BASE_Y },
        ...drones.filter(d => d.isActive).map(d => ({
            id: d.id,
            x: d.position.x,
            y: d.position.y,
            mode: d.mode
        }))
    ];
    
    const adj = new Map<string, string[]>();
    const nodeMap = new Map<string, NetworkNode>();
    nodes.forEach(n => {
        adj.set(n.id, []);
        nodeMap.set(n.id, n);
    });

    const links: Array<{ source: string; target: string }> = [];

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const n1 = nodes[i];
            const n2 = nodes[j];
            const dist = Math.sqrt(
                Math.pow(n1.x - n2.x, 2) + Math.pow(n1.y - n2.y, 2)
            );

            // Get range for each node
            let range1 = COMM_RANGE_DRONE;
            if (n1.id === 'BASE') range1 = COMM_RANGE_BASE;
            else if (n1.mode === 'Relay') range1 = COMM_RANGE_RELAY;

            let range2 = COMM_RANGE_DRONE;
            if (n2.id === 'BASE') range2 = COMM_RANGE_BASE;
            else if (n2.mode === 'Relay') range2 = COMM_RANGE_RELAY;

            // Communication works if within range of EITHER node
            if (dist <= Math.max(range1, range2)) {
                adj.get(n1.id)!.push(n2.id);
                adj.get(n2.id)!.push(n1.id);
                links.push({ source: n1.id, target: n2.id });
            }
        }
    }

    return { adj, links, nodeMap };
}

/**
 * Run BFS from base to find all connected drones and their paths
 */
function bfsFromBase(adj: Map<string, string[]>): {
    connected: Set<string>;
    parent: Map<string, string>;
} {
    const connected = new Set<string>();
    const parent = new Map<string, string>();
    const queue: string[] = ['BASE'];
    connected.add('BASE');

    while (queue.length > 0) {
        const curr = queue.shift()!;
        const neighbors = adj.get(curr) || [];
        for (const nxt of neighbors) {
            if (!connected.has(nxt)) {
                connected.add(nxt);
                parent.set(nxt, curr);
                queue.push(nxt);
            }
        }
    }

    return { connected, parent };
}

/**
 * Reconstruct path from drone to base using parent map
 */
function reconstructPath(droneId: string, parent: Map<string, string>): string[] {
    const path: string[] = [droneId];
    let current = droneId;
    
    while (parent.has(current)) {
        current = parent.get(current)!;
        path.push(current);
    }
    
    return path; // [droneId, ..., BASE] or [droneId] if disconnected
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getCommNetworkStatus
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get the current communication mesh network status.
 * 
 * Returns:
 * - List of connected nodes (drones reachable from base)
 * - List of disconnected nodes
 * - Active communication links
 * - Relay drone position
 * - Base station position
 * 
 * Network topology:
 * - Base station has 12-unit comm range
 * - Relay drone has 10-unit comm range
 * - Search drones have 5-unit comm range
 * - Drones can relay through each other
 */
export async function getCommNetworkStatus(): Promise<MCPToolResult<CommNetworkStatus>> {
    const drones = droneStore.getAllDrones();
    const commLinks = droneStore.getCommLinks();
    
    const connected: string[] = ['BASE'];
    const disconnected: string[] = [];
    
    // Find relay drone
    const relayDrone = drones.find(d => d.mode === 'Relay') || null;
    
    drones.forEach(d => {
        if (d.isConnected) {
            connected.push(d.id);
        } else if (d.isActive) {
            disconnected.push(d.id);
        }
    });

    // Enhance links with signal strength (distance-based)
    const enhancedLinks: CommLink[] = commLinks.map(link => {
        // Calculate signal strength based on distance
        const sourceNode = link.source === 'BASE' 
            ? { x: BASE_X, y: BASE_Y }
            : drones.find(d => d.id === link.source)?.position;
        const targetNode = link.target === 'BASE'
            ? { x: BASE_X, y: BASE_Y }
            : drones.find(d => d.id === link.target)?.position;

        let signalStrength = 1.0;
        if (sourceNode && targetNode) {
            const dist = Math.sqrt(
                Math.pow(sourceNode.x - targetNode.x, 2) +
                Math.pow(sourceNode.y - targetNode.y, 2)
            );
            // Signal degrades with distance
            signalStrength = Math.max(0, 1 - (dist / 12));
        }

        return {
            ...link,
            signalStrength
        };
    });

    return {
        success: true,
        data: {
            connectedNodes: connected,
            disconnectedNodes: disconnected,
            links: enhancedLinks,
            relayDronePosition: relayDrone ? {
                x: relayDrone.position.x,
                y: relayDrone.position.y,
                gridCell: gridToLabel(
                    Math.round(relayDrone.position.x),
                    Math.round(relayDrone.position.y)
                )
            } : null,
            baseStationPosition: {
                x: BASE_X,
                y: BASE_Y,
                gridCell: gridToLabel(BASE_X, BASE_Y)
            }
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: getDisconnectedDrones
// ═══════════════════════════════════════════════════════════════════════════

export interface DisconnectedDroneInfo {
    drone: DroneStatus;
    distanceFromBase: number;
    distanceFromRelay: number | null;
    nearestConnectedDrone: {
        id: string;
        distance: number;
    } | null;
    suggestedAction: string;
}

export interface DisconnectedDronesResult {
    disconnectedCount: number;
    drones: DisconnectedDroneInfo[];
    relayPositionSuggestion: { x: number; y: number; gridCell: string } | null;
}

/**
 * Get detailed information about disconnected drones.
 * 
 * For each disconnected drone, provides:
 * - Distance from base station
 * - Distance from relay drone
 * - Nearest connected drone
 * - Suggested action to restore connectivity
 * 
 * Also suggests optimal relay drone repositioning.
 */
export async function getDisconnectedDrones(): Promise<MCPToolResult<DisconnectedDronesResult>> {
    const drones = droneStore.getAllDrones();
    
    const relayDrone = drones.find(d => d.mode === 'Relay');
    const disconnected = drones.filter(d => !d.isConnected && d.isActive);
    const connected = drones.filter(d => d.isConnected && d.mode !== 'Relay');

    if (disconnected.length === 0) {
        return {
            success: true,
            data: {
                disconnectedCount: 0,
                drones: [],
                relayPositionSuggestion: null
            },
            timestamp: Date.now()
        };
    }

    const droneInfos: DisconnectedDroneInfo[] = disconnected.map(d => {
        const distFromBase = Math.sqrt(
            Math.pow(d.position.x - BASE_X, 2) +
            Math.pow(d.position.y - BASE_Y, 2)
        );

        let distFromRelay: number | null = null;
        if (relayDrone) {
            distFromRelay = Math.sqrt(
                Math.pow(d.position.x - relayDrone.position.x, 2) +
                Math.pow(d.position.y - relayDrone.position.y, 2)
            );
        }

        // Find nearest connected drone
        let nearest: { id: string; distance: number } | null = null;
        for (const cd of connected) {
            const dist = Math.sqrt(
                Math.pow(d.position.x - cd.position.x, 2) +
                Math.pow(d.position.y - cd.position.y, 2)
            );
            if (!nearest || dist < nearest.distance) {
                nearest = { id: cd.id, distance: dist };
            }
        }

        // Suggest action
        let suggestedAction: string;
        if (distFromBase <= COMM_RANGE_BASE) {
            suggestedAction = 'Within base range - check for interference';
        } else if (distFromRelay && distFromRelay <= COMM_RANGE_RELAY) {
            suggestedAction = 'Within relay range - relay may need repositioning';
        } else if (nearest && nearest.distance <= COMM_RANGE_DRONE) {
            suggestedAction = `Can connect via ${nearest.id} - may need mesh update`;
        } else {
            suggestedAction = 'Out of range - reposition relay or recall drone';
        }

        return {
            drone: d,
            distanceFromBase: distFromBase,
            distanceFromRelay: distFromRelay,
            nearestConnectedDrone: nearest,
            suggestedAction
        };
    });

    // Calculate optimal relay position to cover disconnected drones
    let relayPositionSuggestion: { x: number; y: number; gridCell: string } | null = null;
    if (disconnected.length > 0) {
        // Centroid of disconnected drones
        let cx = 0, cy = 0;
        disconnected.forEach(d => {
            cx += d.position.x;
            cy += d.position.y;
        });
        cx /= disconnected.length;
        cy /= disconnected.length;

        // Move toward base to maintain connectivity
        const suggestedX = (cx + BASE_X) / 2;
        const suggestedY = (cy + BASE_Y) / 2;

        relayPositionSuggestion = {
            x: suggestedX,
            y: suggestedY,
            gridCell: gridToLabel(Math.round(suggestedX), Math.round(suggestedY))
        };
    }

    return {
        success: true,
        data: {
            disconnectedCount: disconnected.length,
            drones: droneInfos,
            relayPositionSuggestion
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL: checkDroneConnectivity
// ═══════════════════════════════════════════════════════════════════════════

export interface CheckConnectivityParams {
    droneId: string;
}

export interface ConnectivityCheckResult {
    droneId: string;
    isConnected: boolean;
    connectionPath: string[];
    signalQuality: number;
    wouldLoseConnectionAt: { x: number; y: number } | null;
}

/**
 * Check connectivity status and path for a specific drone.
 * Uses proper BFS mesh network calculation matching SimulationMap.tsx
 * 
 * Returns:
 * - Whether drone is connected to base
 * - Connection path (e.g., ["D1", "D2", "BASE"])
 * - Signal quality (0-1, based on weakest link)
 * - Predicted position where connection would be lost
 */
export async function checkDroneConnectivity(
    params: CheckConnectivityParams
): Promise<MCPToolResult<ConnectivityCheckResult>> {
    const drone = droneStore.getDrone(params.droneId);
    
    if (!drone) {
        return {
            success: false,
            error: `Drone ${params.droneId} not found`,
            timestamp: Date.now()
        };
    }

    const drones = droneStore.getAllDrones();
    
    // Build mesh network and run BFS
    const { adj, nodeMap } = buildMeshNetwork(drones);
    const { connected, parent } = bfsFromBase(adj);
    
    const isConnected = connected.has(drone.id);
    const connectionPath = isConnected 
        ? reconstructPath(drone.id, parent)
        : [drone.id];
    
    // Calculate signal quality based on weakest link in path
    let signalQuality = 1.0;
    if (isConnected && connectionPath.length > 1) {
        for (let i = 0; i < connectionPath.length - 1; i++) {
            const n1 = nodeMap.get(connectionPath[i]);
            const n2 = nodeMap.get(connectionPath[i + 1]);
            if (n1 && n2) {
                const dist = Math.sqrt(
                    Math.pow(n1.x - n2.x, 2) + Math.pow(n1.y - n2.y, 2)
                );
                // Get range for the link
                let range1 = COMM_RANGE_DRONE;
                if (n1.id === 'BASE') range1 = COMM_RANGE_BASE;
                else if (n1.mode === 'Relay') range1 = COMM_RANGE_RELAY;
                
                let range2 = COMM_RANGE_DRONE;
                if (n2.id === 'BASE') range2 = COMM_RANGE_BASE;
                else if (n2.mode === 'Relay') range2 = COMM_RANGE_RELAY;
                
                const effectiveRange = Math.max(range1, range2);
                const linkQuality = Math.max(0, 1 - (dist / effectiveRange));
                signalQuality = Math.min(signalQuality, linkQuality);
            }
        }
    }

    // Calculate where connection would be lost (moving toward target)
    let wouldLoseConnectionAt: { x: number; y: number } | null = null;
    if (isConnected && drone.target) {
        const dx = drone.target.x - drone.position.x;
        const dy = drone.target.y - drone.position.y;
        const stepDist = Math.sqrt(dx * dx + dy * dy);
        
        if (stepDist > 0) {
            const unitX = dx / stepDist;
            const unitY = dy / stepDist;
            
            // Project forward and check connectivity at each step
            for (let t = 0.5; t <= 20; t += 0.5) {
                const testX = drone.position.x + unitX * t;
                const testY = drone.position.y + unitY * t;
                
                // Create a test drone list with updated position
                const testDrones: DroneStatus[] = drones.map(d => 
                    d.id === drone.id 
                        ? { 
                            ...d, 
                            position: { 
                                x: testX, 
                                y: testY,
                                gridCell: gridToLabel(Math.round(testX), Math.round(testY))
                            }
                        }
                        : d
                );
                
                // Check if still connected at test position
                const { adj: testAdj } = buildMeshNetwork(testDrones);
                const { connected: testConnected } = bfsFromBase(testAdj);
                
                if (!testConnected.has(drone.id)) {
                    wouldLoseConnectionAt = { x: testX, y: testY };
                    break;
                }
            }
        }
    }

    return {
        success: true,
        data: {
            droneId: drone.id,
            isConnected,
            connectionPath,
            signalQuality: Math.max(0, signalQuality),
            wouldLoseConnectionAt
        },
        timestamp: Date.now()
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// TOOL REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const communicationTools = {
    getCommNetworkStatus,
    getDisconnectedDrones,
    checkDroneConnectivity
};
