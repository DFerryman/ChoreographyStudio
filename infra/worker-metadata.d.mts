export interface WorkerUploadConfig {
  compatibility_date: string;
  compatibility_flags?: string[];
  vars?: Record<string, unknown>;
  ratelimits?: { name: string; namespace_id: string; simple: { limit: number; period: number } }[];
  ai?: { binding: string; remote?: boolean };
  observability?: { enabled: boolean };
}
export function readWorkerConfig(): Promise<WorkerUploadConfig>;
export function workerMetadata(config: WorkerUploadConfig, mainModule?: string): {
  main_module: string;
  compatibility_date: string;
  compatibility_flags: string[];
  bindings: (
    { type: 'plain_text'; name: string; text: string } |
    { type: 'ratelimit'; name: string; namespace_id: string; simple: { limit: number; period: number } } |
    { type: 'ai'; name: string }
  )[];
  observability?: { enabled: boolean };
};
