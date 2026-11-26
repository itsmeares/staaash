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
-- into rows. Each row keeps its index, which "metadataOperationsApplied"
-- counts, so a mutation that stopped between chunks resumes at the next one.
-- CASE keeps each cast behind its type check. A malformed range is left as
-- it is and still fails closed when the mutation runs.
WITH bulk AS (
  SELECT id, jsonb_array_length("intentJson"->'metadataOperations') AS "length",
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
)
INSERT INTO "StorageMutationOperation" ("mutationId", "ordinal", "operation")
SELECT mutation.id, (operation.ordinal - 1)::integer, operation.value
FROM bulk
JOIN "StorageMutation" mutation ON mutation.id = bulk.id
CROSS JOIN LATERAL jsonb_array_elements(mutation."intentJson"->'metadataOperations')
  WITH ORDINALITY AS operation(value, ordinal)
WHERE bulk."length" > 1000 AND operation.ordinal <= bulk."bulkEnd";

-- The intent keeps what the last transaction commits and counts the rows.
-- With 1,000 operations or fewer the range never applied: all commit at once.
WITH bulk AS (
  SELECT id, jsonb_array_length("intentJson"->'metadataOperations') AS "length",
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
