import "vite-plus/test";

declare module "vitest" {
  export interface ProvidedContext {
    postgresDatabaseUrl: string;
    postgresDatabaseName: string;
    postgresStorageRoot: string;
  }
}
