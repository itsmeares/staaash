BEGIN;

-- CreateTable
CREATE TABLE "StorageMutationOperation" (
    "mutationId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "operation" JSONB NOT NULL,

    CONSTRAINT "StorageMutationOperation_pkey" PRIMARY KEY ("mutationId","ordinal")
);

-- AddForeignKey
ALTER TABLE "StorageMutationOperation" ADD CONSTRAINT "StorageMutationOperation_mutationId_fkey" FOREIGN KEY ("mutationId") REFERENCES "StorageMutation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- An unfinished large mutation moves the operations it commits in chunks
-- into rows. A finished one never reads its plan again and keeps it as it is. Each row keeps its index, which "metadataOperationsApplied"
-- counts, so a mutation that stopped between chunks resumes at the next one.
-- CASE keeps each cast and array call behind its type check, because a
-- WHERE clause does not decide when PostgreSQL evaluates them. A malformed range is left as
-- it is and still fails closed when the mutation runs.
WITH bulk AS (
  SELECT id,
    CASE WHEN jsonb_typeof("intentJson"->'metadataOperations') = 'array'
      THEN jsonb_array_length("intentJson"->'metadataOperations')
    END AS "length",
    CASE
      WHEN jsonb_typeof("intentJson"->'bulkOperationsEnd') = 'number'
        AND jsonb_typeof("intentJson"->'metadataOperations') = 'array'
      THEN CASE
        WHEN ("intentJson"->>'bulkOperationsEnd')::numeric % 1 = 0
          AND ("intentJson"->>'bulkOperationsEnd')::numeric
            BETWEEN 0 AND jsonb_array_length("intentJson"->'metadataOperations')
        THEN ("intentJson"->>'bulkOperationsEnd')::integer
      END
    END AS "bulkEnd"
  FROM "StorageMutation"
  WHERE "intentJson" ? 'bulkOperationsEnd'
    AND jsonb_typeof("intentJson"->'metadataOperations') = 'array'
    AND status NOT IN ('succeeded', 'aborted')
)
INSERT INTO "StorageMutationOperation" ("mutationId", "ordinal", "operation")
SELECT mutation.id, (operation.ordinal - 1)::integer, operation.value
FROM bulk
JOIN "StorageMutation" mutation ON mutation.id = bulk.id
CROSS JOIN LATERAL jsonb_array_elements(CASE
    WHEN jsonb_typeof(mutation."intentJson"->'metadataOperations') = 'array'
    THEN mutation."intentJson"->'metadataOperations'
    ELSE '[]'::jsonb
  END) WITH ORDINALITY AS operation(value, ordinal)
WHERE bulk."length" > 1000 AND operation.ordinal <= bulk."bulkEnd";

-- The intent keeps what the last transaction commits and counts the rows.
-- With 1,000 operations or fewer the range never applied: all commit at once.
WITH bulk AS (
  SELECT id,
    CASE WHEN jsonb_typeof("intentJson"->'metadataOperations') = 'array'
      THEN jsonb_array_length("intentJson"->'metadataOperations')
    END AS "length",
    CASE
      WHEN jsonb_typeof("intentJson"->'bulkOperationsEnd') = 'number'
        AND jsonb_typeof("intentJson"->'metadataOperations') = 'array'
      THEN CASE
        WHEN ("intentJson"->>'bulkOperationsEnd')::numeric % 1 = 0
          AND ("intentJson"->>'bulkOperationsEnd')::numeric
            BETWEEN 0 AND jsonb_array_length("intentJson"->'metadataOperations')
        THEN ("intentJson"->>'bulkOperationsEnd')::integer
      END
    END AS "bulkEnd"
  FROM "StorageMutation"
  WHERE "intentJson" ? 'bulkOperationsEnd'
    AND jsonb_typeof("intentJson"->'metadataOperations') = 'array'
    AND status NOT IN ('succeeded', 'aborted')
)
UPDATE "StorageMutation" mutation
SET "intentJson" = CASE
  WHEN bulk."length" > 1000 AND bulk."bulkEnd" > 0
  THEN (mutation."intentJson" - 'bulkOperationsEnd') || jsonb_build_object(
    'bulkOperationCount', bulk."bulkEnd",
    'metadataOperations', COALESCE((
      SELECT jsonb_agg(operation.value ORDER BY operation.ordinal)
      FROM jsonb_array_elements(mutation."intentJson"->'metadataOperations')
        WITH ORDINALITY AS operation(value, ordinal)
      WHERE operation.ordinal > bulk."bulkEnd"
    ), '[]'::jsonb))
  ELSE mutation."intentJson" - 'bulkOperationsEnd'
END
FROM bulk
WHERE bulk.id = mutation.id AND bulk."bulkEnd" IS NOT NULL;

COMMIT;
