-- The background job that currently owns a derivative's generation attempt, so
-- cancellation and failure writes from an old attempt cannot touch a newer one.
ALTER TABLE "MediaDerivative" ADD COLUMN "generationJobId" TEXT;
