// constellationOrder — ADR-0006 Phase 2 foundation.
//
// Orders the nodes in the unified constellation home. Every node — the
// viewer's own "You" circle AND each person they care for — is a node
// here. The ordering rule we committed to:
//
//   • Calm state: the viewer ("You") sits first; everyone else follows
//     in the order the data layer already sorts them (latest-reading
//     freshness, from fetchParentSummaries).
//   • Urgency overrides: a node that needs attention floats above "You".
//     confirmed-urgent outranks calm-concerned, which outranks everything
//     calm. This is the "at-risk parent front and centre" rule.
//
// Pure function over the existing CaregiverPerson shape so it is unit-
// testable without the RN/data layers. The constellation + cards views
// both consume the ordered result; the highest-ranked node also drives
// which node gets the centre/top slot.
//
// Red/strong visual treatment is the consumer's job and is reserved for
// 'urgent' only (CLAUDE.md: red = confirmed-urgent only; calm-before-
// clever). This module only decides ORDER, never colour.

import type { Status } from '../components/StatusPill';
import type { CaregiverPerson } from './caregiverPerson';

// Higher number = more urgent = sorts earlier. 'sleeping'/'offline' are
// calm states and rank with 'clear' (they never pre-empt "You").
const STATUS_URGENCY: Record<Status, number> = {
  urgent: 3,
  attention: 2,
  watch: 1,
  clear: 0,
  sleeping: 0,
  offline: 0,
  // D13 PR-4 — learning is calm: accumulating data never pre-empts.
  learning: 0,
};

export function statusUrgency(status: Status): number {
  return STATUS_URGENCY[status] ?? 0;
}

/** A constellation node: a CaregiverPerson plus whether it is the viewer's
 *  own circle. `isSelf` is what anchors "You" first in the calm state and
 *  drives the distinct "You" treatment in the views. */
export interface ConstellationNode extends CaregiverPerson {
  isSelf: boolean;
}

/**
 * Order nodes for the unified home.
 *
 * Rule:
 *   1. Any node with urgency > 0 (watch/attention/urgent) sorts before all
 *      calm nodes, most-urgent first. This lets an at-risk person rise
 *      above the viewer's own "You" node.
 *   2. Among equally-urgent nodes, the viewer's own node ("You") comes
 *      first; the rest preserve their incoming (freshness) order.
 *   3. With everyone calm, "You" is first, then the incoming order.
 *
 * Stable: ties preserve input order (Array.prototype.sort is stable in
 * modern JS engines / Hermes).
 */
export function orderConstellationNodes(
  nodes: ConstellationNode[],
): ConstellationNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const ua = statusUrgency(a.node.status);
      const ub = statusUrgency(b.node.status);
      if (ua !== ub) return ub - ua; // more urgent first
      // same urgency tier → self first
      if (a.node.isSelf !== b.node.isSelf) return a.node.isSelf ? -1 : 1;
      return a.index - b.index; // stable: preserve incoming order
    })
    .map((entry) => entry.node);
}

/** The node that should occupy the centre (birds-eye) / top (cards) slot:
 *  simply the first after ordering. Null for an empty constellation. */
export function focalNode(
  nodes: ConstellationNode[],
): ConstellationNode | null {
  const ordered = orderConstellationNodes(nodes);
  return ordered.length > 0 ? ordered[0] : null;
}
