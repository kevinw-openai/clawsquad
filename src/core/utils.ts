import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { JsonMap, JsonValue } from "./types.js";

const execFileAsync = promisify(execFile);

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export function expandHome(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

export async function readJsonFile<T>(filePath: string): Promise<T> {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw) as T;
}

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function readOptionalJsonMap(filePath?: string): Promise<JsonMap> {
  if (filePath == null) {
    return {};
  }

  if (!(await pathExists(filePath))) {
    throw new Error(`Expected JSON vars file at ${filePath}`);
  }

  const value = await readJsonFile<JsonValue>(filePath);
  if (!isJsonMap(value)) {
    throw new Error(`Expected top-level object in ${filePath}`);
  }
  return value;
}

export function isJsonMap(value: JsonValue | unknown): value is JsonMap {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

export function deepMerge(base: JsonMap, overlay: JsonMap): JsonMap {
  const result: JsonMap = { ...base };
  for (const [key, overlayValue] of Object.entries(overlay)) {
    const baseValue = result[key];
    if (isJsonMap(baseValue) && isJsonMap(overlayValue)) {
      result[key] = deepMerge(baseValue, overlayValue);
      continue;
    }
    result[key] = overlayValue;
  }
  return result;
}

export async function walkFiles(rootDir: string): Promise<string[]> {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(absolutePath)));
      continue;
    }
    files.push(absolutePath);
  }

  return files.sort();
}

export async function copyDirContents(sourceDir: string, targetDir: string): Promise<string[]> {
  await ensureDir(targetDir);
  const files = await walkFiles(sourceDir);
  const written: string[] = [];

  for (const filePath of files) {
    const relativePath = path.relative(sourceDir, filePath);
    const destinationPath = path.join(targetDir, relativePath);
    await ensureDir(path.dirname(destinationPath));
    await fs.copyFile(filePath, destinationPath);
    written.push(destinationPath);
  }

  return written;
}

export async function runCommand(
  command: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(command, args, { cwd, env, encoding: "utf8" });
}

export function getByPath(root: JsonMap, dottedPath: string): JsonValue | undefined {
  const parts = dottedPath.split(".");
  let current: JsonValue | undefined = root;

  for (const part of parts) {
    if (!isJsonMap(current)) {
      return undefined;
    }
    current = current[part];
  }

  return current;
}

export function stringifyJsonValue(value: JsonValue | undefined): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export async function writeTextFile(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

export function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}
