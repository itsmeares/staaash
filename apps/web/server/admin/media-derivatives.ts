import { getPrisma } from "@staaash/db/client";

export type AdminMediaDerivativeRow = {
  id: string;
  fileId: string;
  status: string;
  sizeBytes: bigint | null;
  generatedAt: Date | null;
  pinnedByAdmin: boolean;
  error: string | null;
  file: {
    originalName: string;
    sizeBytes: bigint;
    owner: {
      email: string;
      displayName: string | null;
    };
  };
};

export type AdminMediaDerivativeSummary = {
  rows: AdminMediaDerivativeRow[];
  deletedCount: number;
};

export type JsonAdminMediaDerivativeRow = Omit<
  AdminMediaDerivativeRow,
  "sizeBytes" | "generatedAt" | "file"
> & {
  sizeBytes: string | null;
  generatedAt: string | null;
  originalName: string;
  originalSizeBytes: string;
  ownerLabel: string;
};

export type JsonAdminMediaDerivativeSummary = {
  rows: JsonAdminMediaDerivativeRow[];
  deletedCount: number;
};

export const getAdminMediaDerivativeSummary =
  async (): Promise<AdminMediaDerivativeSummary> => {
    const db = getPrisma();
    const [rows, deletedCount] = await Promise.all([
      db.mediaDerivative.findMany({
        where: { file: { deletedAt: null } },
        orderBy: { updatedAt: "desc" },
        take: 200,
        select: {
          id: true,
          fileId: true,
          status: true,
          sizeBytes: true,
          generatedAt: true,
          pinnedByAdmin: true,
          error: true,
          file: {
            select: {
              originalName: true,
              sizeBytes: true,
              owner: { select: { email: true, displayName: true } },
            },
          },
        },
      }),
      db.mediaDerivative.count({
        where: { file: { deletedAt: { not: null } } },
      }),
    ]);

    return { rows, deletedCount };
  };

export const toJsonAdminMediaDerivativeSummary = (
  summary: AdminMediaDerivativeSummary,
): JsonAdminMediaDerivativeSummary => ({
  deletedCount: summary.deletedCount,
  rows: summary.rows.map((row) => ({
    id: row.id,
    fileId: row.fileId,
    status: row.status,
    sizeBytes: row.sizeBytes?.toString() ?? null,
    generatedAt: row.generatedAt?.toISOString() ?? null,
    pinnedByAdmin: row.pinnedByAdmin,
    error: row.error,
    originalName: row.file.originalName,
    originalSizeBytes: row.file.sizeBytes.toString(),
    ownerLabel: row.file.owner.displayName ?? row.file.owner.email,
  })),
});
