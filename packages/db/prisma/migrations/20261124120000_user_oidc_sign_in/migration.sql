-- Sign in through an OIDC provider. An account linked to one may have no
-- password; the provider's issuer and subject identify the person.
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "oidcIssuer" TEXT,
ADD COLUMN "oidcSubject" TEXT;

CREATE UNIQUE INDEX "User_oidcIssuer_oidcSubject_key" ON "User"("oidcIssuer", "oidcSubject");
