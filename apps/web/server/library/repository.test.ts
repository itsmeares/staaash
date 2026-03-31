import { Prisma } from "@staaash/db/client";
import { describe, expect, it } from "vitest";

import { createPrismaLibraryRepository } from "@/server/library/repository";

type MemoryFolderRecord = {
  id: string;
  ownerUserId: string;
  libraryRootKey: string | null;
  parentId: string | null;
  name: string;
  isLibraryRoot: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const createKnownRequestError = () => {
  const error = Object.assign(new Error("Unique constraint failed."), {
    code: "P2002",
  });

  Object.setPrototypeOf(error, Prisma.PrismaClientKnownRequestError.prototype);
  return error as Prisma.PrismaClientKnownRequestError;
};

const createFakePrismaClient = () => {
  const state = {
    folders: [] as MemoryFolderRecord[],
    ids: 0,
    failNextCanonicalCreateForOwner: null as string | null,
  };

  const nextId = () => `folder-${++state.ids}`;

  const addFolder = ({
    ownerUserId,
    libraryRootKey = null,
    parentId = null,
    name = "Library",
    isLibraryRoot = false,
    deletedAt = null,
  }: {
    ownerUserId: string;
    libraryRootKey?: string | null;
    parentId?: string | null;
    name?: string;
    isLibraryRoot?: boolean;
    deletedAt?: Date | null;
  }) => {
    const createdAt = new Date(
      `2026-03-31T12:00:${String(state.ids).padStart(2, "0")}Z`,
    );
    const folder: MemoryFolderRecord = {
      id: nextId(),
      ownerUserId,
      libraryRootKey,
      parentId,
      name,
      isLibraryRoot,
      deletedAt,
      createdAt,
      updatedAt: createdAt,
    };

    state.folders.push(folder);
    return folder;
  };

  const sortByCreatedAt = (folders: MemoryFolderRecord[]) =>
    [...folders].sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        left.id.localeCompare(right.id),
    );

  const folderDelegate = {
    async findFirst(args: {
      where?: {
        ownerUserId?: string;
        libraryRootKey?: string | null;
        isLibraryRoot?: boolean;
      };
      orderBy?: { createdAt?: "asc" | "desc" };
    }) {
      let folders = [...state.folders];

      if (args.where?.ownerUserId !== undefined) {
        folders = folders.filter(
          (folder) => folder.ownerUserId === args.where?.ownerUserId,
        );
      }

      if (args.where?.libraryRootKey !== undefined) {
        folders = folders.filter(
          (folder) => folder.libraryRootKey === args.where?.libraryRootKey,
        );
      }

      if (args.where?.isLibraryRoot !== undefined) {
        folders = folders.filter(
          (folder) => folder.isLibraryRoot === args.where?.isLibraryRoot,
        );
      }

      const [folder] = sortByCreatedAt(folders);
      return folder ?? null;
    },

    async findUnique(args: { where: { id: string } }) {
      return (
        state.folders.find((folder) => folder.id === args.where.id) ?? null
      );
    },

    async findMany(args: {
      where?: {
        ownerUserId?: string;
        libraryRootKey?: string | null;
        isLibraryRoot?: boolean;
      };
    }) {
      let folders = [...state.folders];

      if (args.where?.ownerUserId !== undefined) {
        folders = folders.filter(
          (folder) => folder.ownerUserId === args.where?.ownerUserId,
        );
      }

      if (args.where?.libraryRootKey !== undefined) {
        folders = folders.filter(
          (folder) => folder.libraryRootKey === args.where?.libraryRootKey,
        );
      }

      if (args.where?.isLibraryRoot !== undefined) {
        folders = folders.filter(
          (folder) => folder.isLibraryRoot === args.where?.isLibraryRoot,
        );
      }

      return sortByCreatedAt(folders);
    },

    async create(args: {
      data: {
        ownerUserId: string;
        libraryRootKey?: string | null;
        parentId?: string | null;
        name: string;
        isLibraryRoot?: boolean;
      };
    }) {
      if (
        args.data.libraryRootKey &&
        state.failNextCanonicalCreateForOwner === args.data.ownerUserId
      ) {
        state.failNextCanonicalCreateForOwner = null;
        addFolder({
          ownerUserId: args.data.ownerUserId,
          libraryRootKey: args.data.libraryRootKey,
          parentId: args.data.parentId ?? null,
          name: args.data.name,
          isLibraryRoot: args.data.isLibraryRoot ?? false,
        });
        throw createKnownRequestError();
      }

      return addFolder({
        ownerUserId: args.data.ownerUserId,
        libraryRootKey: args.data.libraryRootKey ?? null,
        parentId: args.data.parentId ?? null,
        name: args.data.name,
        isLibraryRoot: args.data.isLibraryRoot ?? false,
      });
    },

    async update(args: {
      where: { id: string };
      data: Partial<MemoryFolderRecord>;
    }) {
      const folder = state.folders.find((item) => item.id === args.where.id);

      if (!folder) {
        throw new Error(`Folder ${args.where.id} not found`);
      }

      if ("ownerUserId" in args.data && args.data.ownerUserId !== undefined) {
        folder.ownerUserId = args.data.ownerUserId;
      }

      if (
        "libraryRootKey" in args.data &&
        args.data.libraryRootKey !== undefined
      ) {
        folder.libraryRootKey = args.data.libraryRootKey;
      }

      if ("parentId" in args.data) {
        folder.parentId = args.data.parentId ?? null;
      }

      if ("name" in args.data && args.data.name !== undefined) {
        folder.name = args.data.name;
      }

      if (
        "isLibraryRoot" in args.data &&
        args.data.isLibraryRoot !== undefined
      ) {
        folder.isLibraryRoot = args.data.isLibraryRoot;
      }

      if ("deletedAt" in args.data) {
        folder.deletedAt = args.data.deletedAt ?? null;
      }

      folder.updatedAt = new Date(
        `2026-03-31T12:05:${String(state.ids).padStart(2, "0")}Z`,
      );

      return folder;
    },

    async updateMany() {
      return { count: 0 };
    },
  };

  const fileDelegate = {
    async findUnique() {
      return null;
    },

    async findMany() {
      return [];
    },

    async create() {
      throw new Error("Not implemented in this test harness.");
    },

    async update() {
      throw new Error("Not implemented in this test harness.");
    },

    async updateMany() {
      return { count: 0 };
    },

    async delete() {
      return null;
    },
  };

  const transactionClient = {
    folder: folderDelegate,
    file: fileDelegate,
  };

  const client = {
    folder: folderDelegate,
    file: fileDelegate,
    async $transaction<T>(
      callback: (tx: typeof transactionClient) => Promise<T>,
    ) {
      return callback(transactionClient);
    },
  };

  return {
    client,
    state,
    addFolder,
  };
};

describe("prisma library repository", () => {
  it("creates exactly one canonical root when none exists", async () => {
    const { client, state } = createFakePrismaClient();
    const repo = createPrismaLibraryRepository(client as never);

    const root = await repo.ensureLibraryRoot("member-1");

    expect(root.name).toBe("Library");
    expect(root.isLibraryRoot).toBe(true);
    expect(state.folders).toHaveLength(1);
    expect(state.folders[0]?.libraryRootKey).toBe("member-1");
  });

  it("stamps and reuses a single legacy root", async () => {
    const { client, state, addFolder } = createFakePrismaClient();
    const legacyRoot = addFolder({
      ownerUserId: "member-1",
      isLibraryRoot: true,
    });
    const repo = createPrismaLibraryRepository(client as never);

    const root = await repo.ensureLibraryRoot("member-1");

    expect(root.id).toBe(legacyRoot.id);
    expect(state.folders[0]?.libraryRootKey).toBe("member-1");
    expect(state.folders[0]?.isLibraryRoot).toBe(true);
  });

  it("auto-heals duplicate legacy roots under one canonical root", async () => {
    const { client, state, addFolder } = createFakePrismaClient();
    const canonicalCandidate = addFolder({
      ownerUserId: "member-1",
      isLibraryRoot: true,
    });
    const duplicateRoot = addFolder({
      ownerUserId: "member-1",
      isLibraryRoot: true,
      name: "Library Copy",
    });
    const nestedChild = addFolder({
      ownerUserId: "member-1",
      parentId: duplicateRoot.id,
      name: "Nested child",
    });
    const repo = createPrismaLibraryRepository(client as never);

    const root = await repo.ensureLibraryRoot("member-1");

    expect(root.id).toBe(canonicalCandidate.id);
    expect(
      state.folders.find((folder) => folder.id === canonicalCandidate.id)
        ?.libraryRootKey,
    ).toBe("member-1");
    expect(
      state.folders.find((folder) => folder.id === duplicateRoot.id),
    ).toMatchObject({
      isLibraryRoot: false,
      libraryRootKey: null,
      parentId: canonicalCandidate.id,
    });
    expect(
      state.folders.find((folder) => folder.id === nestedChild.id)?.parentId,
    ).toBe(duplicateRoot.id);
  });

  it("re-reads and returns the canonical root after a unique-conflict race", async () => {
    const { client, state } = createFakePrismaClient();
    state.failNextCanonicalCreateForOwner = "member-1";
    const repo = createPrismaLibraryRepository(client as never);

    const root = await repo.ensureLibraryRoot("member-1");

    expect(root.isLibraryRoot).toBe(true);
    expect(root.id).toBe(state.folders[0]?.id);
    expect(state.folders[0]?.libraryRootKey).toBe("member-1");
    expect(state.folders).toHaveLength(1);
  });
});
