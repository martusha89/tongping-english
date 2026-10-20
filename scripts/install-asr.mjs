#!/usr/bin/env node
// TongPing: install the local subtitle (speech recognition) service.
//   npm run asr:install                 Automatic: GPU version with NVIDIA, otherwise CPU
//   npm run asr:install -- --cpu        Force CPU version (smaller download, slower)
//   npm run asr:install -- --cn         Mainland China: Tsinghua pip mirror, models from hf-mirror.com
//   npm run asr:install -- --uninstall  Remove the subtitle service
// Install location: TONGPING_ASR_DIR (default TONGPING_HOME/asr, or ~/.tongping/asr).
// Restart npm run up after installation. TongPing works without it, but AI cannot read dialogue in unsubtitled videos.
import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const envFile = path.join(root, ".env");
loadEnvFile(envFile);
const args = new Set(process.argv.slice(2));
const home = path.resolve(expandHome(process.env.TONGPING_HOME?.trim() || path.join(os.homedir(), ".tongping")));
const asrDir = path.resolve(expandHome(process.env.TONGPING_ASR_DIR?.trim() || path.join(home, "asr")));
const venv = path.join(asrDir, ".venv");
const venvPython = process.platform === "win32"
  ? path.join(venv, "Scripts", "python.exe")
  : path.join(venv, "bin", "python");
const PIP_CN = "https://pypi.tuna.tsinghua.edu.cn/simple";
const HF_CN = "https://hf-mirror.com";

if (args.has("--uninstall")) {
  rmSync(asrDir, { recursive: true, force: true });
  console.log(`Removed ${asrDir}. Downloaded models remain cached at ~/.cache/huggingface; remove them manually if no longer needed.`);
  console.log("Restart npm run up for changes to take effect.");
  process.exit(0);
}

const cn = args.has("--cn");
const wantGpu = !args.has("--cpu") && process.platform !== "darwin" && hasNvidiaGpu();
step(`Install location: ${asrDir}`);
step(`Mode: ${wantGpu ? "GPU (NVIDIA detected; downloads about 1.3 GB of runtime libraries + a 1.6 GB model)" : "CPU (downloads about 0.3 GB of runtime libraries + a 0.5 GB model)"}${cn ? ", mainland China mirrors" : ""}`);

// 1. Python 3.9 - 3.14
const python = findPython();
if (!python) {
  fail("Python 3.9–3.14 was not found. Install Python 3.11 (https://www.python.org/downloads/ ; on Windows, check “Add python.exe to PATH”), then reopen the terminal and retry.");
}
step(`Using Python: ${python.label} (${python.version})`);

// 2. venv
mkdirSync(asrDir, { recursive: true });
if (!existsSync(venvPython)) {
  step("Creating an isolated Python virtual environment…");
  run(python.cmd, [...python.args, "-m", "venv", venv]);
}

// 3. packages
const pipIndex = cn ? ["-i", PIP_CN] : [];
step("Installing faster-whisper (the first installation takes a few minutes)…");
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-q", "--upgrade", "pip"], { allowFail: true });
// av 19 removed an argument faster-whisper 1.2.1 still passes ("open() got an
// unexpected keyword argument 'metadata_errors'"), so keep PyAV on 18.x.
run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", ...pipIndex, "faster-whisper==1.2.1", "av>=11,<19"]);
if (wantGpu) {
  step("Installing GPU runtime libraries (cuBLAS / cuDNN; large download)…");
  const gpu = run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", ...pipIndex, "nvidia-cublas-cu12", "nvidia-cudnn-cu12==9.*"], { allowFail: true });
  if (!gpu) console.warn("  GPU runtime installation failed; will fall back to CPU mode (slower but functional).");
}

// 4. server script
copyFileSync(path.join(root, "asr", "asr_server.py"), path.join(asrDir, "asr_server.py"));

// 5. HF mirror for the model download (also used at runtime by the worker)
if (cn) setEnvLine("HF_ENDPOINT", HF_CN);

// 6. warm up: downloads the model once and checks that it loads
step("Downloading and loading the model (may take a few minutes initially, depending on connection speed)…");
const warm = await warmUp();
if (!warm.ok) {
  console.error("\nModel failed to load: " + warm.error);
  if (/huggingface|hf\.co|Connection|timed out|resolve|SSL|ProxyError|MaxRetry/i.test(warm.error) && !cn) {
    console.error("Cannot seem to reach huggingface.co. For mainland China networks, use: npm run asr:install -- --cn");
  }
  process.exit(1);
}
console.log("");
console.log(`✅ Subtitle service ready: model ${warm.model}, device ${warm.device}, loaded in ${warm.seconds}s`);
console.log("   Restart TongPing (Ctrl+C, then npm run up) to enable it. AI can then read dialogue in unsubtitled videos during Watch Together.");

function hasNvidiaGpu() {
  try { return spawnSync("nvidia-smi", ["-L"], { encoding: "utf8", windowsHide: true }).status === 0; } catch { return false; }
}

function findPython() {
  const candidates = process.platform === "win32"
    ? [["py", ["-3.11"]], ["py", ["-3.12"]], ["py", ["-3.10"]], ["py", ["-3.13"]], ["py", ["-3.14"]], ["python", []], ["python3", []]]
    : [["python3.11", []], ["python3.12", []], ["python3.10", []], ["python3.13", []], ["python3.14", []], ["python3", []], ["python", []]];
  for (const [cmd, pre] of candidates) {
    try {
      const out = spawnSync(cmd, [...pre, "-c", "import sys,venv;print('%d.%d.%d'%sys.version_info[:3])"], { encoding: "utf8", windowsHide: true });
      const version = out.stdout?.trim();
      if (out.status !== 0 || !version) continue;
      const [major, minor] = version.split(".").map(Number);
      if (major === 3 && minor >= 9 && minor <= 14) return { cmd, args: pre, version, label: [cmd, ...pre].join(" ") };
    } catch {}
  }
  return null;
}

function run(cmd, argv, { allowFail = false } = {}) {
  const result = spawnSync(cmd, argv, { stdio: "inherit", windowsHide: true });
  if (result.status === 0) return true;
  if (allowFail) return false;
  fail(`Command failed: ${cmd} ${argv.join(" ")}\nFor network issues, retry with --cn; send the error above to AI and ask it to read F4 in docs/TROUBLESHOOTING.md.`);
}

function warmUp() {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(venvPython, [path.join(asrDir, "asr_server.py")], {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_DISABLE_SYMLINKS_WARNING: "1" },
    });
    let stderr = "";
    let buffer = "";
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: "Loading did not finish within 30 minutes (connection too slow?)" }); }, 30 * 60_000);
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-2000); });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      buffer += chunk;
      for (const line of buffer.split("\n").slice(0, -1)) {
        try {
          const msg = JSON.parse(line);
          if (msg.warning) console.warn("  " + msg.warning);
          if ("ready" in msg) {
            clearTimeout(timer);
            child.stdin.end();
            child.kill();
            resolve(msg.ready
              ? { ok: true, model: msg.model, device: msg.device, seconds: Math.round((Date.now() - started) / 1000) }
              : { ok: false, error: msg.error || stderr });
          }
        } catch {}
      }
      buffer = buffer.slice(buffer.lastIndexOf("\n") + 1);
    });
    child.on("exit", (code) => { clearTimeout(timer); resolve({ ok: false, error: `Process exited with code=${code}\n${stderr.slice(-800)}` }); });
  });
}

function setEnvLine(key, value) {
  // Start from the template so a brand-new .env keeps the usual defaults.
  if (!existsSync(envFile)) copyFileSync(path.join(root, ".env.example"), envFile);
  let text = readFileSync(envFile, "utf8");
  const re = new RegExp(`^\\s*#?\\s*${key}=.*$`, "m");
  text = re.test(text) ? text.replace(re, `${key}=${value}`) : text.replace(/\s*$/, "\n") + `${key}=${value}\n`;
  writeFileSync(envFile, text);
  process.env[key] = value;
  step(`Wrote ${key}=${value} to .env`);
}

function step(message) { console.log("▶ " + message); }
function fail(message) { console.error("❌ " + message); process.exit(1); }
function expandHome(value) {
  return value === "~" || value.startsWith("~/") || value.startsWith("~\\") ? path.join(os.homedir(), value.slice(1)) : value;
}
function loadEnvFile(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && process.env[key] === undefined) process.env[key] = value;
  }
}
