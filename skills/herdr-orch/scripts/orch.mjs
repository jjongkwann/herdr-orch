#!/usr/bin/env node
// Open, prompt, wait for, stop and close worker agents in herdr panes beside the
// orchestrator pane. The calling pane is the orchestrator; workers fill the same
// tab toward a ROWSxCOLS grid (ORCH_GRID, default 2x3), one pane at a time.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `usage: node orch.mjs <command> [options]

  spawn <name> <kind> [--cwd DIR] [--mcp] [-- agent args]
                        start a worker in a free slot or a new pane
  send <name> <prompt|->
                        submit a prompt; returns once the worker starts
  wait [<name>...] [--any] [--timeout SEC] [--lines N]
                        block until workers finish and print their report summaries
  ask <name> <prompt|-> [--timeout SEC] [--lines N]
                        send, then wait for that worker
  ls                    list slots
  stop <name>... | --all
                        exit worker agents; their panes stay as free slots
  close [--force]       close free slots (--force also closes busy ones)`;

const [ROWS, COLS] = (process.env.ORCH_GRID || "2x3").split("x").map(Number);
const STATE_DIR = join(
  process.env.XDG_STATE_HOME ||
    (process.platform === "win32"
      ? process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local")
      : join(homedir(), ".local", "state")),
  "herdr-orch",
);
const REPORT_DIR = join(STATE_DIR, "reports");
const NAME_RE = /^[a-z][a-z0-9_-]{0,31}$/;
// Slash commands that end each agent's session; other kinds get Ctrl+C twice.
const EXIT_COMMAND = { claude: "/exit", codex: "/quit", agy: "/exit" };
const contract = (path) => `

---
When you finish, write the full result as Markdown to ${path}. Start that file with at most five lines: status (done, blocked or failed), changed files, and a one-line summary. Put the details below them. Then reply with only the report path.`;

function die(message) {
  console.error(`orch: ${message}`);
  process.exit(1);
}

function errorText(proc) {
  try {
    const { code, message } = JSON.parse(proc.stderr).error;
    return `${code}: ${message}`;
  } catch {
    return String(proc.stderr || proc.stdout).trim();
  }
}

function herdr(args, { check = true } = {}) {
  const proc = spawnSync("herdr", args, { encoding: "utf8" });
  if (proc.error) die(`cannot run herdr: ${proc.error.message}`);
  if (check && proc.status !== 0) die(errorText(proc));
  return proc;
}

const result = (args) => JSON.parse(herdr(args).stdout).result;
const agentExists = (name) => herdr(["agent", "get", name], { check: false }).status === 0;

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitUntil(check, ms) {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) return false;
    sleep(500);
  }
  return true;
}

function samePath(a, b) {
  const norm = (p) => (process.platform === "win32" ? resolve(p).toLowerCase() : resolve(p));
  return norm(a) === norm(b);
}

function stateFile(tab) {
  // Pane and tab IDs are only unique within one herdr server, so key by its socket too.
  const server = createHash("sha1").update(process.env.HERDR_SOCKET_PATH || "").digest("hex").slice(0, 8);
  return join(STATE_DIR, `${server}-${tab.replace(/:/g, "_")}.json`);
}

function saveState(tab, state) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(stateFile(tab), `${JSON.stringify(state, null, 2)}\n`);
}

// Read the caller's tab, its layout and this script's live slots in it.
function openTab() {
  if (process.env.HERDR_ENV !== "1") die("not running inside a herdr pane");
  const orchestrator = process.env.HERDR_PANE_ID;
  const tab = process.env.HERDR_TAB_ID;
  const layout = result(["pane", "layout", "--pane", orchestrator]).layout;
  let state = { slots: [], reports: {} };
  try {
    state = JSON.parse(readFileSync(stateFile(tab), "utf8"));
  } catch {}
  const live = new Set(layout.panes.map((p) => p.pane_id));
  const slots = state.slots.filter((p) => live.has(p));
  if (slots.length !== state.slots.length) {
    state.slots = slots;
    saveState(tab, state);
  }
  return { orchestrator, tab, layout, state };
}

function agentsByPane() {
  return new Map(result(["agent", "list"]).agents.map((a) => [a.pane_id, a]));
}

function isFree(pane, agents) {
  if (agents.has(pane)) return false;
  const info = result(["pane", "process-info", "--pane", pane]).process_info;
  const procs = info.foreground_processes;
  return procs.length === 1 && procs[0].pid === info.shell_pid;
}

// Pick the pane to split so the tab fills toward a ROWS x COLS grid.
function nextSplit(orchestrator, slots, layout) {
  const colWidth = layout.area.width / COLS;
  const rowHeight = layout.area.height / ROWS;
  const rects = new Map(layout.panes.map((p) => [p.pane_id, p.rect]));
  const cells = (pane) => {
    const r = rects.get(pane);
    return [Math.round(r.width / colWidth), Math.round(r.height / rowHeight)];
  };
  const workers = slots.filter((p) => rects.has(p));
  const wide = workers.filter((p) => cells(p)[0] > 1);
  if (wide.length) {
    const pane = wide.reduce((a, b) => (cells(b)[0] > cells(a)[0] ? b : a));
    return [pane, "right", 1 / cells(pane)[0]];
  }
  const tall = workers.filter((p) => cells(p)[1] > 1);
  if (tall.length) {
    const pane = tall.reduce((a, b) => (rects.get(b).x < rects.get(a).x ? b : a));
    return [pane, "down", 1 / cells(pane)[1]];
  }
  const [cols, rows] = cells(orchestrator);
  if (cols > 1) return [orchestrator, "right", 1 / cols];
  if (rows > 1) return [orchestrator, "down", 1 / rows];
  return null;
}

function spawnWorker(positionals, values, extra) {
  const [name, kind] = positionals;
  if (!name || !kind) die("usage: spawn <name> <kind> [--cwd DIR] [--mcp] [-- agent args]");
  if (!NAME_RE.test(name)) die("name must match [a-z][a-z0-9_-]{0,31}");
  if (agentExists(name)) die(`agent ${name} already exists`);
  const cwd = resolve(values.cwd || process.cwd());
  const t = openTab();
  const agents = agentsByPane();
  const paneCwd = (pane) => result(["pane", "get", pane]).pane.cwd;

  let pane = t.state.slots.find((p) => isFree(p, agents) && samePath(paneCwd(p), cwd));
  if (!pane) {
    // A free slot in another directory is replaced, so no shell-specific cd is needed.
    const other = t.state.slots.find((p) => isFree(p, agents));
    if (other) {
      herdr(["pane", "close", other]);
      t.state.slots = t.state.slots.filter((p) => p !== other);
      saveState(t.tab, t.state);
      t.layout = result(["pane", "layout", "--pane", t.orchestrator]).layout;
    }
    if (t.state.slots.length >= ROWS * COLS - 1) die("every slot has a worker; stop one first");
    const split = nextSplit(t.orchestrator, t.state.slots, t.layout);
    if (!split) die("no room left in this tab; run the orchestrator in a tab of its own");
    const [target, direction, ratio] = split;
    pane = result([
      "pane", "split", target, "--direction", direction, "--ratio", ratio.toFixed(4),
      "--cwd", cwd, "--no-focus",
    ]).pane.pane_id;
    t.state.slots.push(pane);
    saveState(t.tab, t.state);
    if (!waitUntil(() => isFree(pane, new Map()), 10000)) die(`shell in ${pane} did not become ready`);
  }

  const agentArgs = kind === "claude" ? ["-n", name, ...(values.mcp ? [] : ["--strict-mcp-config"])] : [];
  agentArgs.push(...extra);
  const start = ["agent", "start", name, "--kind", kind, "--pane", pane];
  if (agentArgs.length) start.push("--", ...agentArgs);
  const proc = herdr(start, { check: false });
  if (proc.status !== 0) {
    const error = errorText(proc);
    if (!error.startsWith("agent_not_ready")) die(`${error} (pane ${pane} is left as a free slot)`);
    // Blocked at startup, for example by a folder trust prompt; show it to the caller.
    const screen = herdr(["agent", "read", name, "--source", "visible"], { check: false }).stdout;
    console.error(screen.split(/\r?\n/).filter((l) => l.trim()).slice(-15).join("\n"));
    die(`${error}; answer with herdr agent send-keys ${name} <keys>, or ask the user`);
  }
  console.log(`${name} ${kind} ${pane}`);
}

function sendPrompt(positionals) {
  const [name, prompt] = positionals;
  if (!name || prompt === undefined) die("usage: send <name> <prompt|->");
  const text = prompt === "-" ? readFileSync(0, "utf8") : prompt;
  const t = openTab();
  mkdirSync(REPORT_DIR, { recursive: true });
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const report = join(REPORT_DIR, `${name}-${stamp}.md`);
  const proc = herdr([
    "agent", "prompt", name, text + contract(report),
    "--wait", "--until", "working", "--until", "blocked", "--timeout", "30000",
  ], { check: false });
  if (proc.status !== 0) {
    const error = errorText(proc);
    if (error.startsWith("agent_blocked") || error.startsWith("agent_not_found")) die(error);
    // A timeout or stall does not prove the prompt was lost; keep the report path for wait.
    console.error(`orch: ${error}; inspect ${name} before sending again`);
  }
  t.state.reports[name] = report;
  saveState(t.tab, t.state);
  console.log(`${name}: sent (report: ${report})`);
}

function waitForFile(path, ms) {
  return new Promise((done) => {
    const deadline = Date.now() + ms;
    const poll = () => {
      if (existsSync(path) || Date.now() > deadline) done();
      else setTimeout(poll, 1000);
    };
    poll();
  });
}

function waitOne(name, report, timeout, children) {
  return new Promise((done) => {
    const args = ["agent", "wait", name];
    if (timeout) args.push("--timeout", String(timeout * 1000));
    const child = spawn("herdr", args, { stdio: ["ignore", "pipe", "pipe"] });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", async (code) => {
      let status = code === 0 ? JSON.parse(stdout).result.agent.agent_status : errorText({ stderr, stdout });
      if (!agentExists(name)) status = "exited";
      // Some agents settle before the report lands; give the write a moment.
      else if ((status === "idle" || status === "done") && report) await waitForFile(report, 60000);
      done({ name, status, report });
    });
  });
}

function summary({ name, status, report }, lines) {
  const out = [`${name}: ${status}`];
  if (report && existsSync(report)) {
    out.push(`report: ${report}`);
    for (const line of readFileSync(report, "utf8").split(/\r?\n/).slice(0, 6)) {
      if (!line.trim()) break;
      out.push(line);
    }
  } else if (status === "exited") {
    out.push("report: not written");
  } else {
    out.push("report: not written; last screen lines:");
    const screen = herdr(["agent", "read", name, "--source", "recent-unwrapped", "--lines", String(lines)], { check: false });
    out.push(...screen.stdout.split(/\r?\n/).slice(-lines));
  }
  return out.join("\n");
}

async function waitWorkers(names, values) {
  const t = openTab();
  const targets = names.length
    ? names
    : Object.keys(t.state.reports).filter((n) => !existsSync(t.state.reports[n]) && agentExists(n));
  if (!targets.length) die("nothing to wait for");
  const lines = Number(values.lines || 30);
  const timeout = values.timeout ? Number(values.timeout) : 0;
  const children = [];
  const waits = targets.map((n) => waitOne(n, t.state.reports[n], timeout, children));
  let ok = true;
  const report = (r) => {
    console.log(`${summary(r, lines)}\n`);
    if (!(r.report && existsSync(r.report))) ok = false;
  };
  if (values.any) {
    report(await Promise.race(waits));
    children.forEach((c) => c.kill());
  } else {
    await Promise.all(waits.map((w) => w.then(report)));
  }
  process.exit(ok ? 0 : 1);
}

function stopWorkers(names, values) {
  const t = openTab();
  const workers = new Map();
  for (const [pane, agent] of agentsByPane()) {
    if (t.state.slots.includes(pane)) workers.set(agent.name || pane, agent);
  }
  const targets = values.all ? [...workers.keys()] : names;
  if (!targets.length) die("name a worker or pass --all");
  let failed = false;
  for (const name of targets) {
    const agent = workers.get(name);
    if (!agent) {
      console.error(`${name}: not a worker in this tab`);
      failed = true;
      continue;
    }
    const gone = () => !agentExists(name);
    const command = EXIT_COMMAND[agent.agent];
    if (command) herdr(["agent", "prompt", name, command], { check: false });
    if (!command || !waitUntil(gone, 10000)) herdr(["agent", "send-keys", name, "ctrl+c", "ctrl+c"], { check: false });
    if (waitUntil(gone, 5000)) {
      console.log(`${name}: stopped (${agent.pane_id} is free)`);
    } else {
      console.error(`${name}: still running in ${agent.pane_id}; close --force closes the pane`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}

function closeSlots(values) {
  const t = openTab();
  const agents = agentsByPane();
  const kept = [];
  for (const pane of t.state.slots) {
    if (values.force || isFree(pane, agents)) {
      herdr(["pane", "close", pane]);
      console.log(`${pane}: closed`);
    } else {
      kept.push(pane);
      console.log(`${pane}: busy, kept`);
    }
  }
  t.state.slots = kept;
  saveState(t.tab, t.state);
}

function listSlots() {
  const t = openTab();
  const agents = agentsByPane();
  console.log(`${t.state.slots.length}/${ROWS * COLS - 1} slots`);
  for (const pane of t.state.slots) {
    const a = agents.get(pane);
    if (a) console.log(`${pane}  ${a.name || "-"}  ${a.agent}  ${a.agent_status}`);
    else console.log(`${pane}  ${isFree(pane, agents) ? "free" : "busy (no agent)"}`);
  }
}

function main() {
  if (!(ROWS >= 1 && COLS >= 1 && ROWS * COLS >= 2)) die("ORCH_GRID must look like 2x3");
  let argv = process.argv.slice(2);
  let extra = [];
  const cut = argv.indexOf("--");
  if (cut >= 0) [argv, extra] = [argv.slice(0, cut), argv.slice(cut + 1)];
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    console.log(USAGE);
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      allowPositionals: true,
      options: {
        cwd: { type: "string" },
        mcp: { type: "boolean" },
        timeout: { type: "string" },
        lines: { type: "string" },
        any: { type: "boolean" },
        all: { type: "boolean" },
        force: { type: "boolean" },
      },
    });
  } catch (error) {
    die(error.message);
  }
  const { positionals, values } = parsed;
  if (extra.length && command !== "spawn") die("arguments after -- are only for spawn");
  switch (command) {
    case "spawn": return spawnWorker(positionals, values, extra);
    case "send": return sendPrompt(positionals);
    case "wait": return waitWorkers(positionals, values);
    case "ask":
      sendPrompt(positionals);
      return waitWorkers([positionals[0]], values);
    case "ls": return listSlots();
    case "stop": return stopWorkers(positionals, values);
    case "close": return closeSlots(values);
    default: die(`unknown command ${command}\n${USAGE}`);
  }
}

main();
