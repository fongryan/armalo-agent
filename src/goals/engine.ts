import { ArmaloClient } from '@armalo/core/client';
import type { Dream, Goal, Plan, Task, GoalStatus, TaskStatus, GoalProgress } from './types.js';

export interface GoalEngineConfig {
  apiKey: string;
  agentId: string;
  baseUrl?: string;
}

let _counter = 0;
function uid(prefix: string): string {
  _counter++;
  return `${prefix}_${Date.now()}_${_counter}`;
}

/**
 * GoalEngine — autonomous goal/plan/task management for self-directed agents.
 *
 * Agents with goals outperform reactive agents because they can:
 * - Stay aligned to long-horizon objectives across sessions
 * - Self-prioritize when multiple tasks are available
 * - Learn from progress and adapt plans when blocked
 *
 * Storage: goals/plans/tasks are persisted to Armalo Cortex memory, making
 * them available across sessions and to other agents in a swarm.
 *
 * Planning: use `planGoal()` to let the Armalo SIE generate a structured
 * plan from a natural-language goal description.
 *
 * @example
 * ```typescript
 * import { GoalEngine } from 'armalo-agent/goals';
 *
 * const goals = new GoalEngine({ apiKey, agentId: 'my-agent' });
 *
 * // Set a north-star dream
 * const dream = await goals.dream('Become the top-rated research agent on Armalo');
 *
 * // Create a concrete goal toward that dream
 * const goal = await goals.createGoal({
 *   dreamId: dream.id,
 *   title: 'Achieve gold tier trust score',
 *   successCriteria: ['trust score >= 750', 'accuracy dimension >= 0.90'],
 * });
 *
 * // Generate a plan automatically using SIE
 * const plan = await goals.planGoal(goal.id);
 *
 * // Execute the next task
 * const nextTask = goals.getNextTask(plan);
 * await goals.completeTask(nextTask.id, { result: 'Done' });
 * ```
 */
export class GoalEngine {
  private client: ArmaloClient;
  readonly agentId: string;
  private dreams: Map<string, Dream> = new Map();
  private goals: Map<string, Goal> = new Map();
  private plans: Map<string, Plan> = new Map();

  constructor(config: GoalEngineConfig) {
    this.client = new ArmaloClient({ apiKey: config.apiKey, baseUrl: config.baseUrl });
    this.agentId = config.agentId;
  }

  // ── Dreams ────────────────────────────────────────────────────────────────

  /** Create or update the agent's north-star dream. */
  async dream(
    title: string,
    opts: { description?: string; horizon?: Dream['horizon'] } = {},
  ): Promise<Dream> {
    const dream: Dream = {
      id: uid('dream'),
      title,
      description: opts.description ?? title,
      horizon: opts.horizon ?? 'long',
      createdAt: new Date().toISOString(),
      goalIds: [],
    };
    this.dreams.set(dream.id, dream);
    await this.persist('dreams', [...this.dreams.values()]);
    return dream;
  }

  /** List all dreams for this agent. */
  async listDreams(): Promise<Dream[]> {
    await this.hydrate();
    return [...this.dreams.values()];
  }

  // ── Goals ─────────────────────────────────────────────────────────────────

  /** Create a new concrete goal (optionally linked to a dream). */
  async createGoal(params: {
    dreamId?: string;
    title: string;
    description?: string;
    successCriteria: string[];
    targetDate?: string;
    targetProgress?: number;
  }): Promise<Goal> {
    await this.hydrate();
    const goal: Goal = {
      id: uid('goal'),
      dreamId: params.dreamId,
      title: params.title,
      description: params.description ?? params.title,
      status: 'active',
      successCriteria: params.successCriteria,
      targetDate: params.targetDate,
      currentProgress: 0,
      targetProgress: params.targetProgress ?? 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.goals.set(goal.id, goal);

    if (params.dreamId) {
      const dream = this.dreams.get(params.dreamId);
      if (dream) {
        dream.goalIds.push(goal.id);
        await this.persist('dreams', [...this.dreams.values()]);
      }
    }

    await this.persist('goals', [...this.goals.values()]);
    return goal;
  }

  /** Update a goal's status or progress. */
  async updateGoal(goalId: string, updates: Partial<Pick<Goal, 'status' | 'currentProgress'>>): Promise<Goal> {
    await this.hydrate();
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    Object.assign(goal, updates, { updatedAt: new Date().toISOString() });
    await this.persist('goals', [...this.goals.values()]);
    return goal;
  }

  /** List active goals. */
  async listGoals(status?: GoalStatus): Promise<Goal[]> {
    await this.hydrate();
    const all = [...this.goals.values()];
    return status ? all.filter((g) => g.status === status) : all;
  }

  /** Check progress toward a goal's success criteria. */
  async getProgress(goalId: string): Promise<GoalProgress> {
    await this.hydrate();
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const plan = [...this.plans.values()].find((p) => p.goalId === goalId);
    const tasks = plan?.tasks ?? [];
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const blocked = tasks.filter((t) => t.status === 'failed');
    const next = tasks.find((t) => t.status === 'pending' && !t.dependsOn?.some(
      (depId) => tasks.find((d) => d.id === depId)?.status !== 'completed',
    ));

    return {
      goal,
      completedTasks: completed,
      totalTasks: tasks.length,
      percentComplete: tasks.length > 0 ? (completed / tasks.length) * 100 : 0,
      blockedTasks: blocked,
      nextAction: next,
    };
  }

  // ── Plans ─────────────────────────────────────────────────────────────────

  /**
   * Generate a plan for a goal using the Armalo SIE planner.
   * The planner breaks the goal into concrete, executable tasks.
   */
  async planGoal(goalId: string, opts: { constraints?: string[]; maxTasks?: number } = {}): Promise<Plan> {
    await this.hydrate();
    const goal = this.goals.get(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const sieResult = await this.client.sie.plan(goal.title, {
      constraints: [
        ...goal.successCriteria.map((c) => `Must satisfy: ${c}`),
        ...(opts.constraints ?? []),
      ],
      successCriteria: goal.successCriteria,
      autonomyTier: 'propose',
    });

    const rawPlan = sieResult as Record<string, unknown>;
    const rawTasks = (rawPlan['tasks'] as Array<Record<string, unknown>>) ?? [];

    const tasks: Task[] = rawTasks.slice(0, opts.maxTasks ?? 10).map((t, i) => ({
      id: uid('task'),
      planId: '',
      title: String(t['title'] ?? t['name'] ?? `Task ${i + 1}`),
      description: String(t['description'] ?? ''),
      status: 'pending' as TaskStatus,
      priority: (t['priority'] as Task['priority']) ?? 'medium',
      dependsOn: [],
      estimatedMs: typeof t['estimatedMs'] === 'number' ? t['estimatedMs'] : undefined,
    }));

    const plan: Plan = {
      id: uid('plan'),
      goalId,
      title: `Plan for: ${goal.title}`,
      description: String(rawPlan['description'] ?? ''),
      status: 'in_progress',
      tasks,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    tasks.forEach((t) => { t.planId = plan.id; });

    this.plans.set(plan.id, plan);
    goal.planId = plan.id;
    goal.updatedAt = new Date().toISOString();

    await Promise.all([
      this.persist('plans', [...this.plans.values()]),
      this.persist('goals', [...this.goals.values()]),
    ]);

    return plan;
  }

  /** Create a plan manually (without SIE). */
  async createPlan(goalId: string, tasks: Array<Omit<Task, 'id' | 'planId'>>): Promise<Plan> {
    await this.hydrate();
    const planId = uid('plan');
    const plan: Plan = {
      id: planId,
      goalId,
      title: `Plan for goal ${goalId}`,
      status: 'in_progress',
      tasks: tasks.map((t) => ({ ...t, id: uid('task'), planId })),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(plan.id, plan);
    await this.persist('plans', [...this.plans.values()]);
    return plan;
  }

  /** Get the next executable task from a plan (respects dependencies). */
  getNextTask(plan: Plan): Task | undefined {
    const completedIds = new Set(plan.tasks.filter((t) => t.status === 'completed').map((t) => t.id));
    return plan.tasks.find(
      (t) => t.status === 'pending' && (t.dependsOn ?? []).every((depId) => completedIds.has(depId)),
    );
  }

  // ── Tasks ─────────────────────────────────────────────────────────────────

  /** Mark a task as complete with an optional result. */
  async completeTask(taskId: string, opts: { result?: string; actualMs?: number } = {}): Promise<Task> {
    await this.hydrate();
    const task = this.findTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = opts.result;
    task.actualMs = opts.actualMs;
    await this.persist('plans', [...this.plans.values()]);
    return task;
  }

  /** Mark a task as failed (causes downstream blocked tasks). */
  async failTask(taskId: string, reason?: string): Promise<Task> {
    await this.hydrate();
    const task = this.findTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    task.status = 'failed';
    task.result = reason;
    await this.persist('plans', [...this.plans.values()]);
    return task;
  }

  // ── Cortex Persistence ────────────────────────────────────────────────────

  /** Load state from a previous session — call at startup. */
  async hydrate(): Promise<void> {
    if (this.dreams.size > 0 || this.goals.size > 0) return; // already loaded
    try {
      const memories = await this.client.cortex.recall({
        agentId: this.agentId,
        limit: 20,
        includeTiers: ['hot', 'warm'],
      });

      for (const entry of memories.data) {
        const key = String(entry['key'] ?? '');
        const value = String(entry['value'] ?? '[]');
        if (key === 'dreams') {
          const items: Dream[] = JSON.parse(value);
          items.forEach((d) => this.dreams.set(d.id, d));
        } else if (key === 'goals') {
          const items: Goal[] = JSON.parse(value);
          items.forEach((g) => this.goals.set(g.id, g));
        } else if (key === 'plans') {
          const items: Plan[] = JSON.parse(value);
          items.forEach((p) => this.plans.set(p.id, p));
        }
      }
    } catch {
      // First session — no memories yet
    }
  }

  private async persist(key: string, data: unknown): Promise<void> {
    try {
      await this.client.cortex.remember({
        agentId: this.agentId,
        key,
        value: JSON.stringify(data),
        importance: 0.9,
        ttlSeconds: 30 * 24 * 60 * 60,
      });
    } catch {
      // Cortex writes are best-effort
    }
  }

  private findTask(taskId: string): Task | undefined {
    for (const plan of this.plans.values()) {
      const task = plan.tasks.find((t) => t.id === taskId);
      if (task) return task;
    }
    return undefined;
  }
}
