import { z } from 'zod';

export const NodeStatusSchema = z.enum(['offline', 'online', 'degraded']);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const NodeRoleSchema = z.enum(['controller', 'worker']);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const ShareStatusSchema = z.enum(['pending', 'active', 'error']);
export type ShareStatus = z.infer<typeof ShareStatusSchema>;

export const MountStatusSchema = z.enum(['pending', 'active', 'error']);
export type MountStatus = z.infer<typeof MountStatusSchema>;

export const PoolStatusSchema = z.enum(['pending', 'active', 'error']);
export const PoolMemberStatusSchema = z.enum(['pending', 'active', 'error']);
export const PoolMemberRoleSchema = z.enum(['primary', 'replica']);

export const AlertSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const AlertStatusSchema = z.enum(['open', 'acknowledged', 'resolved']);

export const NotificationChannelTypeSchema = z.enum(['email', 'webhook', 'slack']);
export const SyncJobStatusSchema = z.enum(['pending', 'running', 'success', 'failed']);
export const MigrationStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const AgentHeartbeatSchema = z.object({
  nodeId: z.string(),
  metrics: z.object({
    cpu: z.number(),
    ram: z.number(),
    disk: z.number(),
    networkRx: z.number().optional(),
    networkTx: z.number().optional(),
    ioRead: z.number().optional(),
    ioWrite: z.number().optional(),
  }),
});

export const CreatePoolSchema = z.object({
  name: z.string().min(2),
  strategy: z.string().min(2),
  status: PoolStatusSchema.optional(),
});

export const CreateAlertRuleSchema = z.object({
  name: z.string().min(2),
  metric: z.string().min(2),
  comparator: z.enum(['gt', 'gte', 'lt', 'lte']),
  threshold: z.number(),
  severity: AlertSeveritySchema,
  enabled: z.boolean().optional(),
  nodeId: z.string().optional(),
  notificationChannelId: z.string().optional(),
});

export const CreateSyncJobSchema = z.object({
  name: z.string().min(2),
  sourcePath: z.string().min(1),
  targetPath: z.string().min(1),
  schedule: z.string().min(1),
  nodeId: z.string().optional(),
});

export const CreateMigrationSchema = z.object({
  name: z.string().min(2),
  shareId: z.string().optional(),
  sourceNodeId: z.string().optional(),
  targetNodeId: z.string().optional(),
  notes: z.string().optional(),
});

export type LoginRequest = z.infer<typeof LoginRequestSchema>;
export type AgentHeartbeat = z.infer<typeof AgentHeartbeatSchema>;
export type CreatePoolInput = z.infer<typeof CreatePoolSchema>;
export type CreateAlertRuleInput = z.infer<typeof CreateAlertRuleSchema>;
export type CreateSyncJobInput = z.infer<typeof CreateSyncJobSchema>;
export type CreateMigrationInput = z.infer<typeof CreateMigrationSchema>;
