#!/usr/bin/env node
import process from "node:process";
import { promisify } from 'node:util';
import { execFile as execFileCb } from 'node:child_process';
import { loadAmbientEnv, DEFAULT_MODEL } from "./shared.js";

const execFile = promisify(execFileCb);

await loadAmbientEnv();

const TRUTHY = new Set(["1", "true", "yes", "on", "y"]);

const rawFlag = String(process.env.ENABLE_GARDEN_IMAGEGEN || "").trim().toLowerCase();
const gardenEnabled = TRUTHY.has(rawFlag);

const apiKey = process.env.OPENAI_API_KEY || "";
const baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const model = process.env.OPENAI_IMAGE_MODEL || DEFAULT_MODEL;
const hostHasImageTool = TRUTHY.has(String(process.env.IMG_GEN_HOST_HAS_IMAGE_TOOL || '').trim().toLowerCase());
const codexBin = process.env.CODEX_BIN || 'codex';

async function detectCodex() {
  try {
    await execFile(codexBin, ['--help'], { maxBuffer: 1024 * 1024 });
    return true;
  } catch {
    return false;
  }
}

let recommendation;
let mode;
let summary;
const codexAvailable = await detectCodex();

if (gardenEnabled && apiKey) {
  mode = "A";
  recommendation = "garden";
  summary =
    "MODE A · Garden 本地生图：用 scripts/generate.js / scripts/edit.js 直接出图并落盘。";
} else if (gardenEnabled && !apiKey) {
  mode = "A?";
  recommendation = "garden-missing-key";
  summary =
    "ENABLE_GARDEN_IMAGEGEN 已开，但缺 OPENAI_API_KEY。先向用户索要 key，或临时降级到 MODE B / C / D。";
} else if (hostHasImageTool) {
  mode = 'B';
  recommendation = 'host-native-image-tool';
  summary =
    'MODE B · 宿主原生图像工具：img-gen-pro 负责模板与 prompt，宿主负责真出图。';
} else if (codexAvailable) {
  mode = 'C';
  recommendation = 'codex-cli-render';
  summary =
    'MODE C · Codex CLI 出图：img-gen-pro 负责 prompt，Codex render 必须通过 exec(pty=true) 执行，默认只先落本地。';
} else {
  mode = "D";
  recommendation = "advisor";
  summary =
    "MODE D · 纯 prompt 顾问：A / B / C 都不可用，只产出高质量 prompt 给用户。";
}

const result = {
  mode,
  recommendation,
  garden_mode_enabled: gardenEnabled,
  has_api_key: Boolean(apiKey),
  host_has_image_tool: hostHasImageTool,
  codex_cli_available: codexAvailable,
  codex_bin: codexBin,
  base_url: baseUrl,
  model,
  env_flag_value: rawFlag || "(unset)",
  summary,
};

const wantJson = process.argv.includes("--json");

if (wantJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const pad = (s) => s.padEnd(24, " ");
  console.log("--- gpt-image-2 runtime mode ---");
  console.log(`${pad("mode")}: ${result.mode}`);
  console.log(`${pad("recommendation")}: ${result.recommendation}`);
  console.log(`${pad("garden_mode_enabled")}: ${result.garden_mode_enabled}`);
  console.log(`${pad("has_api_key")}: ${result.has_api_key}`);
  console.log(`${pad("host_has_image_tool")}: ${result.host_has_image_tool}`);
  console.log(`${pad("codex_cli_available")}: ${result.codex_cli_available}`);
  console.log(`${pad("codex_bin")}: ${result.codex_bin}`);
  console.log(`${pad("base_url")}: ${result.base_url}`);
  console.log(`${pad("model")}: ${result.model}`);
  console.log(`${pad("env_flag_value")}: ${result.env_flag_value}`);
  console.log("");
  console.log(result.summary);
}
