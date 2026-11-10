export class StorageMutationConflictError extends Error {
  readonly code:
    | "STORAGE_MUTATION_IN_PROGRESS"
    | "STORAGE_MUTATION_RECOVERING"
    | "STORAGE_RECOVERY_REQUIRED"
    | "STORAGE_IDEMPOTENCY_KEY_REUSED";
  readonly status: 409 | 503;
  readonly mutationId?: string;
  /** Sent with the error, so a client can tell which change holds the item. */
  readonly details?: { mutationKind: string };

  constructor(
    code:
      | "STORAGE_MUTATION_IN_PROGRESS"
      | "STORAGE_MUTATION_RECOVERING"
      | "STORAGE_RECOVERY_REQUIRED"
      | "STORAGE_IDEMPOTENCY_KEY_REUSED",
    mutationId?: string,
    mutationKind?: string,
  ) {
    super(
      code === "STORAGE_MUTATION_IN_PROGRESS"
        ? "Another durable storage mutation owns this resource."
        : code === "STORAGE_MUTATION_RECOVERING"
          ? "The durable storage mutation is being recovered."
          : code === "STORAGE_RECOVERY_REQUIRED"
            ? "The durable storage mutation requires operator recovery."
            : "Idempotency key was reused with a different request.",
    );
    this.name = "StorageMutationConflictError";
    this.code = code;
    this.status = code === "STORAGE_IDEMPOTENCY_KEY_REUSED" ? 409 : 503;
    this.mutationId = mutationId;
    if (mutationKind) this.details = { mutationKind };
  }
}
