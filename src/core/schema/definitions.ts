/*
* definitions.ts
*
* Copyright (C) 2021 by RStudio, PBC
*
*/

import { withValidator } from "../lib/yaml-intelligence/validator-queue.ts";
import { convertFromYaml } from "./from-yaml.ts";
import { idSchema, refSchema } from "./common.ts";
import { readYaml } from "../yaml.ts";
import { ensureAjv } from "./yaml-schema.ts";
import {
  hasSchemaDefinition,
  normalizeSchema,
  Schema,
  setSchemaDefinition,
  getSchemaDefinition
} from "../lib/schema.ts";
import { error } from "log/mod.ts";
import { schemaPath } from "./utils.ts";
import { buildSchemaResources } from "./from-yaml.ts";

export function defineCached(
  thunk: () => Promise<Schema>,
  schemaId: string,
): (() => Promise<Schema>) {
  let schema: Schema;
  
  return async () => {
    // when running on the CLI outside of quarto build-js, these
    // definitions will already exist.
    if (hasSchemaDefinition(schemaId)) {
      schema = getSchemaDefinition(schemaId);
      return refSchema(
        schema!.$id as string,
        (schema!.description as string) || `be a {schema['$id']}`,
      );
    }

    await ensureAjv();
    if (!hasSchemaDefinition(schemaId)) {
      schema = await thunk();
      if (schemaId !== schema!.$id as string) {
        schema = idSchema(schema, schemaId);
      }
      await define(schema);
    }
    return refSchema(
      schema!.$id as string,
      (schema!.description as string) || `be a {schema['$id']}`,
    );
  };
}

export async function define(schema: Schema) {
  await ensureAjv();
  if (!hasSchemaDefinition(schema.$id)) {
    await withValidator(normalizeSchema(schema), async (_validator) => {
      setSchemaDefinition(schema);
    });
  }
}

export async function loadDefaultSchemaDefinitions() {
  await loadSchemaDefinitions(schemaPath("definitions.yml"));
  await buildSchemaResources();
}

export async function loadSchemaDefinitions(file: string) {
  // deno-lint-ignore no-explicit-any
  const yaml = readYaml(file) as any[];

  await ensureAjv();
  await Promise.all(yaml.map(async (yamlSchema) => {
    const schema = convertFromYaml(yamlSchema);
    if (schema.$id === undefined) {
      console.log(JSON.stringify(yamlSchema, null, 2));
      error(JSON.stringify(schema, null, 2));
      throw new Error(`Internal error: unnamed schema in definitions`);
    }
    await withValidator(normalizeSchema(schema), async (_validator) => {
      setSchemaDefinition(schema);
    });
  }));
}
