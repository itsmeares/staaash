import assert from "node:assert/strict";
import { test } from "node:test";

import { breakingChanges } from "./openapi-compat.mjs";

const spec = ({
  responseFields = ["id", "name"],
  kinds = ["file", "folder"],
  required = ["name"],
  responseRequired = ["id", "name"],
} = {}) => ({
  paths: {
    "/api/items/{id}": {
      post: {
        parameters: [
          {
            in: "path",
            name: "id",
            required: true,
            schema: { type: "string" },
          },
          {
            in: "query",
            name: "ifRevision",
            required: false,
            schema: { type: "integer" },
          },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  note: { type: "string" },
                },
                required,
              },
            },
          },
        },
        responses: {
          200: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: Object.fromEntries(
                    responseFields.map((field) => [field, { type: "string" }]),
                  ),
                  required: responseRequired,
                },
              },
            },
          },
        },
      },
    },
  },
  components: { schemas: { Kind: { type: "string", enum: kinds } } },
});

test("allows added routes, fields, and enum values", () => {
  const reordered = spec();
  reordered.paths["/api/items/{id}"].post.parameters.reverse();
  assert.deepEqual(breakingChanges(spec(), reordered), []);
  const next = spec({
    responseFields: ["id", "name", "size"],
    kinds: ["file", "folder", "link"],
  });
  next.paths["/api/new"] = { get: { responses: {} } };
  assert.deepEqual(breakingChanges(spec(), next), []);
});

test("refuses removed routes, fields, enum values, and new required inputs", () => {
  const problems = breakingChanges(
    spec(),
    spec({
      responseFields: ["id"],
      kinds: ["file"],
      required: ["name", "note"],
    }),
  );
  assert.equal(problems.length, 3);
  assert.match(problems.join("\n"), /properties\/name was removed/);
  assert.match(problems.join("\n"), /no longer allows "folder"/);
  assert.match(problems.join("\n"), /now requires note/);
  const stricter = spec();
  stricter.paths["/api/items/{id}"].post.parameters[1].required = true;
  assert.match(
    breakingChanges(spec(), stricter).join("\n"),
    /ifRevision is now required/,
  );
  assert.match(
    breakingChanges(spec(), spec({ responseRequired: ["id"] })).join("\n"),
    /200\/content\/application\/json\/schema no longer always has name/,
  );
  assert.deepEqual(breakingChanges(spec(), { paths: {} }), [
    "POST /api/items/{id} was removed",
    "components was removed",
  ]);
});
