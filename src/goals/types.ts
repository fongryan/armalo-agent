export type GoalStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type PlanStatus = 'draft' | 'in_progress' | 'completed' | 'blocked';
export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped';
export type DreamHorizon = 'near' | 'medium' | 'long' | 'ultimate';

/**
 * A Dream is the agent's north-star aspiration — a qualitative direction.
 * Dreams don't have deadlines; they inform which Goals to pursue.
 *
 * Example: "Become the highest-rated TypeScript code review agent on Armalo"
 */
export interface Dream {
  id: string;
  title: string;
  description: string;
  horizon: DreamHorizon;
  createdAt: string;
  goalIds: string[];
}

/**
 * A Goal is a concrete, measurable objective derived from a Dream.
 * Goals have success criteria and an owner (the agent).
 *
 * Example: "Reach gold tier (trust score ≥ 750) within 30 days"
 */
export interface Goal {
  id: string;
  dreamId?: string;
  title: string;
  description: string;
  status: GoalStatus;
  successCriteria: string[];
  targetDate?: string;
  currentProgress?: number;
  targetProgress?: number;
  createdAt: string;
  updatedAt: string;
  planId?: string;
}

/**
 * A Plan is a structured breakdown of how to achieve a Goal.
 * Contains ordered tasks and dependencies between them.
 */
export interface Plan {
  id: string;
  goalId: string;
  title: string;
  description?: string;
  status: PlanStatus;
  tasks: Task[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A Task is a discrete unit of work in a Plan.
 * Tasks are small enough to be executed in a single agent session.
 */
export interface Task {
  id: string;
  planId: string;
  title: string;
  description?: string;
  status: TaskStatus;
  priority: 'critical' | 'high' | 'medium' | 'low';
  dependsOn?: string[];
  completedAt?: string;
  result?: string;
  estimatedMs?: number;
  actualMs?: number;
}

export interface GoalProgress {
  goal: Goal;
  completedTasks: number;
  totalTasks: number;
  percentComplete: number;
  blockedTasks: Task[];
  nextAction?: Task;
}
