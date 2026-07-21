import type { Effect } from "effect";
import { z } from "zod";
import type { CastClient } from "../domain/CastClient.ts";
import type { CastError } from "../domain/errors.ts";

export type ToolCategory = "discovery" | "media" | "queue" | "apps" | "volume";

export interface ToolAnnotations {
  title: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDefinition<
  Name extends string = string,
  Shape extends z.ZodRawShape = z.ZodRawShape,
> {
  name: Name;
  description: string;
  category: ToolCategory;
  parameters: Shape;
  schema: z.ZodObject<Shape>;
  annotations: ToolAnnotations;
  // biome-ignore lint/suspicious/noExplicitAny: params validated at runtime via schema
  execute: (params: any) => Effect.Effect<unknown, CastError, CastClient>;
}

export const createTool = <Name extends string, Shape extends z.ZodRawShape>(def: {
  name: Name;
  description: string;
  category: ToolCategory;
  parameters: Shape;
  annotations: ToolAnnotations;
  execute: (params: z.infer<z.ZodObject<Shape>>) => Effect.Effect<unknown, CastError, CastClient>;
}): ToolDefinition<Name, Shape> => ({
  ...def,
  schema: z.object(def.parameters),
});
