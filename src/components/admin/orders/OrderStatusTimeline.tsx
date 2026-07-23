import {
  buildTimelineRows,
  getTimelineForCarrier,
  type TimelinePresetName,
  type TimelineRow,
} from "@/config/status-timelines";
import {
  normalizeStatusCode,
  STATUS_LABELS,
  type StatusCode,
} from "@/config/status-vocabulary";
import type { CarrierSlug } from "@/config/carrier-slugs";
import type { CarrierTimelineStage } from "@/config/status-timelines";
import OrderStatusTimelineNode, {
  type TimelineNodeState,
} from "./OrderStatusTimelineNode";

interface Props {
  orderId: string;
  carrierSlug: CarrierSlug | null;
  timelinePreset: TimelinePresetName | null;
  fulfillmentStatus: string;
}

// ---------------------------------------------------------------------------
// Layout constants — SVG-coordinate space.
// ---------------------------------------------------------------------------

const SVG_WIDTH = 340;
const SPINE_X = 110;
const LEFT_BRANCH_X = 30;
const RIGHT_BRANCH_X = 240;
const ROW_HEIGHT = 84;
const ROW_PADDING = 22;
const MAIN_NODE_SIZE = 18;
const BRANCH_NODE_SIZE = 14;
const MAIN_LABEL_X = SPINE_X + 18;
const BRANCH_LABEL_RIGHT_X = RIGHT_BRANCH_X + 12;
const BRANCH_LABEL_LEFT_X = LEFT_BRANCH_X - 12;

/**
 * Per-order status timeline — branch-on-demand SVG graph.
 *
 *   - Main spine flows BOTTOM (draft) → TOP (delivered/collected). Reversed
 *     flow communicates "the order grows upward".
 *   - Exception branches render ONLY when the order is currently on that
 *     exception. Recoverable exceptions show a primary out-curve to the
 *     active node plus a faded merge-back arc to the spine at rejoinsAt
 *     (visualizing the available return path). Terminal exceptions show a
 *     one-way curve to a stop marker — no return.
 *   - When the order is on a happy-path main stage, the timeline is purely
 *     a vertical stepper. Latent branches are NOT rendered — they belong
 *     to the carrier's documentation surface, not the order's state.
 *
 * Visual states:
 *   - Completed spine + nodes filled bright (path below the current position)
 *   - Active node glows
 *   - Pending spine + nodes dim
 *
 * Nodes are HTML buttons absolutely positioned over an SVG that handles
 * all connecting paths (cubic-bezier curves for smoothness, no Unicode
 * arrow hacks).
 */
export default function OrderStatusTimeline({
  orderId,
  carrierSlug,
  timelinePreset,
  fulfillmentStatus,
}: Props) {
  const timeline = getTimelineForCarrier(carrierSlug, timelinePreset);
  const rows = buildTimelineRows(timeline);
  const current = normalizeStatusCode(fulfillmentStatus);

  // Identify the active exception (if any). The timeline only renders the
  // branch when the order is currently on that exception — otherwise the
  // spine reads as a pure vertical journey.
  const activeException = findActiveException(rows, current);
  const currentMainIndex = computeCurrentMainIndex(rows, current, activeException);

  const totalRows = rows.length;
  const svgHeight = ROW_PADDING * 2 + totalRows * ROW_HEIGHT;

  // Bottom-up Y mapping. Row index 0 (draft) sits at the BOTTOM.
  const rowY = (i: number) =>
    ROW_PADDING + (totalRows - 1 - i) * ROW_HEIGHT + ROW_HEIGHT / 2;

  const spineTopY = rowY(totalRows - 1);
  const spineBottomY = rowY(0);
  const spinePath = `M ${SPINE_X},${spineBottomY} L ${SPINE_X},${spineTopY}`;
  const completedTopY =
    currentMainIndex >= 0 ? rowY(currentMainIndex) : spineBottomY;
  const completedSpinePath =
    currentMainIndex >= 0
      ? `M ${SPINE_X},${spineBottomY} L ${SPINE_X},${completedTopY}`
      : "";

  // Resolve the active branch's render parameters (sprout row, side, return
  // target). Returns null when there's no active exception.
  const activeBranchRender = activeException
    ? buildBranchRender(activeException, rows, rowY)
    : null;

  return (
    <div className="border rounded p-4 bg-card">
      <header className="mb-3">
        <h2 className="text-sm font-semibold">Πορεία παραγγελίας</h2>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Διαβάζεται από κάτω (αρχή) προς τα πάνω (παράδοση). Οι παρεκκλίσεις
          εμφανίζονται μόνο όταν η παραγγελία βρίσκεται σε αυτές.
        </p>
      </header>

      <div
        className="relative mx-auto"
        style={{ width: SVG_WIDTH, height: svgHeight }}
      >
        <svg
          width={SVG_WIDTH}
          height={svgHeight}
          viewBox={`0 0 ${SVG_WIDTH} ${svgHeight}`}
          className="absolute inset-0"
          aria-hidden
        >
          {/* Dim full spine */}
          <path
            d={spinePath}
            stroke="currentColor"
            className="text-muted-foreground/25"
            strokeWidth={2}
            fill="none"
            strokeLinecap="round"
          />
          {/* Completed spine segment */}
          {completedSpinePath && (
            <path
              d={completedSpinePath}
              stroke="currentColor"
              className="text-primary"
              strokeWidth={2.5}
              fill="none"
              strokeLinecap="round"
            />
          )}

          {/* Active branch — only renders when the order is on an exception */}
          {activeBranchRender && (
            <g
              className={
                activeBranchRender.side === "left"
                  ? "text-amber-500"
                  : "text-destructive"
              }
            >
              {/* Primary out-arc — bright */}
              <path
                d={activeBranchRender.outPath}
                stroke="currentColor"
                strokeWidth={2}
                fill="none"
                strokeLinecap="round"
              />
              {/* Recoverable: faded merge-back arc hinting the return path */}
              {activeBranchRender.side === "left" &&
                activeBranchRender.returnPath && (
                  <path
                    d={activeBranchRender.returnPath}
                    stroke="currentColor"
                    strokeWidth={1.5}
                    fill="none"
                    strokeLinecap="round"
                    strokeDasharray="3 3"
                    opacity={0.55}
                  />
                )}
              {/* Terminal: small stop bar at the end of the branch */}
              {activeBranchRender.side === "right" && (
                <line
                  x1={activeBranchRender.branchX - 10}
                  y1={activeBranchRender.branchY + 10}
                  x2={activeBranchRender.branchX + 10}
                  y2={activeBranchRender.branchY + 10}
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                />
              )}
            </g>
          )}
        </svg>

        {/* HTML node + label layer */}
        <div className="absolute inset-0">
          {rows.map((row, rowIdx) => {
            const spineY = rowY(rowIdx);
            const mainState = computeMainState(
              rowIdx,
              currentMainIndex,
              activeException !== null
            );
            return (
              <div key={row.main.code}>
                <NodePosition x={SPINE_X} y={spineY} size={MAIN_NODE_SIZE}>
                  <OrderStatusTimelineNode
                    orderId={orderId}
                    code={row.main.code}
                    state={mainState}
                    variant="main"
                    size={MAIN_NODE_SIZE}
                  />
                </NodePosition>
                <LabelPosition x={MAIN_LABEL_X} y={spineY} align="left">
                  <span
                    className={`text-xs leading-tight whitespace-nowrap ${
                      mainState === "completed" || mainState === "active"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    } ${mainState === "active" ? "font-medium" : ""}`}
                  >
                    {STATUS_LABELS[row.main.code]?.admin ?? row.main.code}
                  </span>
                </LabelPosition>
              </div>
            );
          })}

          {/* Active branch node + label */}
          {activeBranchRender && activeException && (
            <>
              <NodePosition
                x={activeBranchRender.branchX}
                y={activeBranchRender.branchY}
                size={BRANCH_NODE_SIZE}
              >
                <OrderStatusTimelineNode
                  orderId={orderId}
                  code={activeException.code}
                  state="active-exception"
                  variant={
                    activeBranchRender.side === "left"
                      ? "recoverable"
                      : "terminal"
                  }
                  size={BRANCH_NODE_SIZE}
                />
              </NodePosition>
              <LabelPosition
                x={
                  activeBranchRender.side === "left"
                    ? BRANCH_LABEL_LEFT_X
                    : BRANCH_LABEL_RIGHT_X
                }
                y={activeBranchRender.branchY}
                align={activeBranchRender.side === "left" ? "right" : "left"}
              >
                <span
                  className={`text-[10px] leading-tight whitespace-nowrap font-medium ${
                    activeBranchRender.side === "left"
                      ? "text-amber-700"
                      : "text-destructive"
                  }`}
                >
                  {STATUS_LABELS[activeException.code]?.admin ??
                    activeException.code}
                </span>
              </LabelPosition>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function NodePosition({
  x,
  y,
  size,
  children,
}: {
  x: number;
  y: number;
  size: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
      }}
    >
      {children}
    </div>
  );
}

function LabelPosition({
  x,
  y,
  align,
  children,
}: {
  x: number;
  y: number;
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute"
      style={{
        left: align === "left" ? x : "auto",
        right: align === "right" ? SVG_WIDTH - x : "auto",
        top: y,
        transform: "translateY(-50%)",
      }}
    >
      {children}
    </div>
  );
}

interface BranchRender {
  side: "left" | "right";
  branchX: number;
  branchY: number;
  /** Primary out-curve path — solid, bright. */
  outPath: string;
  /** Recoverable only: faded dashed arc back to the rejoinsAt spine point. */
  returnPath: string | null;
}

/**
 * Computes SVG paths + position for the active exception branch.
 * Recoverable branches sprout LEFT (with a faded return arc to rejoinsAt).
 * Terminal branches sprout RIGHT (no return).
 */
function buildBranchRender(
  exception: CarrierTimelineStage,
  rows: TimelineRow[],
  rowY: (i: number) => number
): BranchRender | null {
  const sproutRowIdx = rows.findIndex(
    (r) => r.main.code === exception.branchesFrom
  );
  if (sproutRowIdx < 0) return null;
  const sproutY = rowY(sproutRowIdx);

  const side: "left" | "right" = exception.terminal ? "right" : "left";
  const branchX = side === "left" ? LEFT_BRANCH_X : RIGHT_BRANCH_X;
  // For recoverable, shift the branch node slightly up so the return arc
  // has visible separation from the out arc.
  const branchY = side === "left" ? sproutY - 8 : sproutY;

  const outPath = arcPath(SPINE_X, sproutY, branchX, branchY, side);

  let returnPath: string | null = null;
  if (side === "left" && exception.rejoinsAt) {
    const rejoinRowIdx = rows.findIndex(
      (r) => r.main.code === exception.rejoinsAt
    );
    if (rejoinRowIdx >= 0) {
      const rejoinY = rowY(rejoinRowIdx);
      // Mirror the bulge direction so out + return don't overlap.
      returnPath = arcPath(branchX, branchY + 4, SPINE_X, rejoinY, side, true);
    }
  }

  return { side, branchX, branchY, outPath, returnPath };
}

function arcPath(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  side: "left" | "right",
  reverse = false
): string {
  const dx = Math.abs(x2 - x1) * 0.55;
  // For same-row curves, bulge slightly outward; for cross-row, the dy
  // delta already provides curvature.
  const sameRow = Math.abs(y2 - y1) < 4;
  const bulge = sameRow ? (side === "left" ? -10 : 10) : 0;
  const bulgeY = reverse ? -bulge : bulge;
  const cp1x = side === "left" ? x1 - dx : x1 + dx;
  const cp1y = y1 + bulgeY;
  const cp2x = side === "left" ? x2 + dx : x2 - dx;
  const cp2y = y2 + bulgeY;
  return `M ${x1},${y1} C ${cp1x},${cp1y} ${cp2x},${cp2y} ${x2},${y2}`;
}

function findActiveException(
  rows: TimelineRow[],
  current: StatusCode
): CarrierTimelineStage | null {
  for (const row of rows) {
    const branch = [...row.leftBranches, ...row.rightBranches].find(
      (b) => b.code === current
    );
    if (branch) return branch;
  }
  return null;
}

function computeCurrentMainIndex(
  rows: TimelineRow[],
  current: StatusCode,
  activeException: CarrierTimelineStage | null
): number {
  if (activeException && activeException.branchesFrom) {
    const idx = rows.findIndex(
      (r) => r.main.code === activeException.branchesFrom
    );
    if (idx >= 0) return idx;
  }
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].main.code === current) return i;
  }
  return -1;
}

function computeMainState(
  idx: number,
  currentIdx: number,
  hasActiveException: boolean
): TimelineNodeState {
  if (idx < currentIdx) return "completed";
  if (idx === currentIdx) {
    return hasActiveException ? "completed" : "active";
  }
  return "pending";
}
