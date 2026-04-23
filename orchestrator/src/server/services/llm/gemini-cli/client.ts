import { spawn } from "node:child_process";
import { logger } from "@infra/logger";
import type { JsonSchemaDefinition, LlmRequestOptions } from "../types";
import { truncate } from "../utils/string";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_STDERR_LINES = 40;

function getPositiveIntEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function buildGeminiCliErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("ENOENT")) {
    return "Gemini CLI was not found in PATH. Install it with `npm install -g @google/gemini-cli` and try again.";
  }
  return truncate(message, 500);
}

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "AbortError" || error.message.includes("aborted");
}

function formatPrompt(args: {
  messages: LlmRequestOptions<unknown>["messages"];
  jsonSchema: JsonSchemaDefinition;
}): string {
  const transcript = args.messages
    .map((message, index) => {
      return `Message ${index + 1} (${message.role.toUpperCase()}):\n${message.content.trim()}`;
    })
    .join("\n\n");

  return [
    "You are generating a structured JSON response for JobOps.",
    "Do not run commands or tools. Answer directly.",
    "Return only valid JSON with no markdown fences or extra text.",
    "The response must follow this schema exactly:",
    JSON.stringify(args.jsonSchema.schema, null, 2),
    "Conversation:",
    transcript,
  ].join("\n\n");
}

async function runGeminiCli(args: {
  prompt: string;
  model: string | null;
  signal?: AbortSignal;
}): Promise<string> {
  const command = process.env.GEMINI_CLI_BIN?.trim() || "gemini";
  const spawnArgs = ["-p", args.prompt];
  if (args.model) {
    spawnArgs.push("--model", args.model);
  }

  return await new Promise<string>((resolve, reject) => {
    const proc = spawn(command, spawnArgs, {
      stdio: "pipe",
      cwd: process.cwd(),
      env: process.env,
    });

    const stdoutChunks: string[] = [];
    const stderrLines: string[] = [];

    proc.stdout.on("data", (chunk: Buffer | string) => {
      stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    });

    proc.stderr.on("data", (chunk: Buffer | string) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        stderrLines.push(trimmed);
        if (stderrLines.length > MAX_STDERR_LINES) {
          stderrLines.shift();
        }
      }
    });

    const timeoutMs = getPositiveIntEnv("GEMINI_CLI_TIMEOUT_MS", DEFAULT_TIMEOUT_MS);
    const timer = setTimeout(() => {
      proc.kill("SIGTERM");
      reject(new Error(`Gemini CLI request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    let abortCleanup: (() => void) | null = null;
    if (args.signal) {
      if (args.signal.aborted) {
        clearTimeout(timer);
        proc.kill("SIGTERM");
        reject(new Error("Gemini CLI request was aborted."));
        return;
      }
      const onAbort = () => {
        clearTimeout(timer);
        proc.kill("SIGTERM");
        reject(new Error("Gemini CLI request was aborted."));
      };
      args.signal.addEventListener("abort", onAbort, { once: true });
      abortCleanup = () => args.signal?.removeEventListener("abort", onAbort);
    }

    proc.once("error", (error) => {
      clearTimeout(timer);
      abortCleanup?.();
      reject(new Error(buildGeminiCliErrorMessage(error)));
    });

    proc.once("exit", (code, signal) => {
      clearTimeout(timer);
      abortCleanup?.();

      const output = stdoutChunks.join("").trim();

      if (code === 0) {
        if (!output) {
          reject(new Error("Gemini CLI exited successfully but returned no output."));
          return;
        }
        resolve(output);
        return;
      }

      const detail = stderrLines.at(-1) || output;
      const reason = detail
        ? truncate(detail, 400)
        : `Gemini CLI exited with code=${code ?? "null"}, signal=${signal ?? "null"}.`;
      reject(new Error(reason));
    });
  });
}

export class GeminiCliClient {
  async validateCredentials(signal?: AbortSignal): Promise<{
    valid: boolean;
    message: string | null;
  }> {
    const command = process.env.GEMINI_CLI_BIN?.trim() || "gemini";

    return await new Promise((resolve) => {
      const proc = spawn(command, ["--version"], {
        stdio: "pipe",
        cwd: process.cwd(),
        env: process.env,
      });

      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
        resolve({
          valid: false,
          message: "Gemini CLI validation timed out.",
        });
      }, 10_000);

      let abortCleanup: (() => void) | null = null;
      if (signal) {
        const onAbort = () => {
          clearTimeout(timer);
          proc.kill("SIGTERM");
          resolve({ valid: false, message: "Gemini CLI validation was cancelled." });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        abortCleanup = () => signal.removeEventListener("abort", onAbort);
      }

      proc.once("error", (error) => {
        clearTimeout(timer);
        abortCleanup?.();
        resolve({ valid: false, message: buildGeminiCliErrorMessage(error) });
      });

      proc.once("exit", (code) => {
        clearTimeout(timer);
        abortCleanup?.();
        if (code === 0) {
          resolve({ valid: true, message: null });
        } else {
          resolve({
            valid: false,
            message:
              "Gemini CLI is not authenticated. Run `gemini auth login` and try again.",
          });
        }
      });
    });
  }

  async callJson(
    options: LlmRequestOptions<unknown>,
  ): Promise<{ text: string }> {
    const prompt = formatPrompt({
      messages: options.messages,
      jsonSchema: options.jsonSchema,
    });

    const model = options.model?.trim() || null;

    logger.debug("Gemini CLI request", {
      jobId: options.jobId ?? "unknown",
      model: model ?? "default",
    });

    const text = await runGeminiCli({
      prompt,
      model,
      signal: options.signal,
    });

    return { text };
  }
}
