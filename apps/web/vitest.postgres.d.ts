import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    postgresDatabaseUrl: string;
    postgresDatabaseName: string;
    postgresStorageRoot: string;
  }
}
