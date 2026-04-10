export interface Point {
    x: number;
    y: number;
}

const distanceToSegment = (p: Point, a: Point, b: Point): number => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;

    if (dx === 0 && dy === 0) {
        return Math.hypot(p.x - a.x, p.y - a.y);
    }

    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
    const projX = a.x + t * dx;
    const projY = a.y + t * dy;
    return Math.hypot(p.x - projX, p.y - projY);
};

const rdp = (points: Point[], tolerance: number): Point[] => {
    if (points.length <= 2) return points.slice();

    let maxDistance = 0;
    let index = 0;

    for (let i = 1; i < points.length - 1; i++) {
        const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
        if (distance > maxDistance) {
            index = i;
            maxDistance = distance;
        }
    }

    if (maxDistance > tolerance) {
        const left = rdp(points.slice(0, index + 1), tolerance);
        const right = rdp(points.slice(index), tolerance);
        return left.slice(0, -1).concat(right);
    }

    return [points[0], points[points.length - 1]];
};

export const simplifyPath = (points: Point[], tolerance = 0.5): Point[] => {
    if (!points || points.length <= 2) return points.slice();

    const cleaned: Point[] = [];
    for (const point of points) {
        const last = cleaned[cleaned.length - 1];
        if (!last || last.x !== point.x || last.y !== point.y) {
            cleaned.push({ x: point.x, y: point.y });
        }
    }

    if (cleaned.length <= 2) return cleaned;
    return rdp(cleaned, tolerance);
};

/**
 * Checks if a point (x,y) is inside a polygon defined by an array of points.
 * Uses the ray-casting algorithm.
 */
export const isPointInPolygon = (x: number, y: number, polygon: Point[]): boolean => {
    if (!polygon || polygon.length < 3) return false;

    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const xi = polygon[i].x, yi = polygon[i].y;
        const xj = polygon[j].x, yj = polygon[j].y;

        const intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
};
