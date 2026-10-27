#!/usr/bin/env node
// Open, prompt, wait for, stop and close worker agents in herdr panes beside the
// orchestrator pane. The calling pane is the orchestrator; workers fill the same
// tab one pane at a time, toward a grid that fits the current tab size.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { parseArgs } from "node:util";

const USAGE = `usage: node orch.mjs <command> [options]

  spawn <name> <kind> [--cwd DIR] [--worktree [--base REF]] [--mcp] [-- agent args]
                        start a worker in a free slot or a new pane
  send <name> <prompt|->
                        submit a prompt; returns once the worker starts
  wait [<name>...] [--any] [--timeout SEC] [--lines N]
                        block until workers finish and print their report summaries
  ask <name> <prompt|-> [--timeout SEC] [--lines N]
                        send, then wait for that worker
  ls                    list slots
  worktrees [--clean] [--base REF]
                        show the worktrees orch made; --clean removes merged ones
  log [--lines N]       show this tab's run: past actions and unfinished work
  lessons               show the lesson files for this project and for all projects
  setup [add <file> | decline]
                        show, add or decline the rule for global instructions
  stop <name>... | --all
                        exit worker agents; their panes stay as free slots
  close [--force]       close free slots (--force also closes busy ones)`;

const MAX_WORKERS = Number(process.env.ORCH_MAX_WORKERS || 5);
const [MIN_WIDTH, MIN_HEIGHT] = (process.env.ORCH_MIN_PANE || "80x24").split("x").map(Number);
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
You are a herdr-orch worker: do not open panes or start agents with herdr-orch. When you finish, write the full result as Markdown to ${path}; write this report even if the task says not to change files. Start that file with at most five lines: status (done, blocked or failed), changed files, and a one-line summary. Put the details below them. Then reply with only the report path.`;

// Agents pick skills from one-line descriptions, and built-in subagents usually
// win; this rule in the user's always-loaded instructions makes them use workers.
const RULE = "- Inside herdr (HERDR_ENV=1), use the herdr-orch skill without being asked when a task has two or more independent parts that take longer than a quick lookup, or when a code change should get a second reviewer. Prefer its pane workers to built-in subagents for that work.";
const RULE_MARK = "herdr-orch skill without being asked";
const SETUP_FILE = join(STATE_DIR, "setup.json");
// Worktrees that `spawn --worktree` created, so `worktrees --clean` never touches others.
const WORKTREES_FILE = join(STATE_DIR, "worktrees.json");

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

function git(args, cwd, { check = true } = {}) {
  const proc = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (proc.error) die(`cannot run git: ${proc.error.message}`);
  if (check && proc.status !== 0) die(`git ${args[0]}: ${String(proc.stderr || proc.stdout).trim()}`);
  return proc;
}

const gitOut = (args, cwd) => git(args, cwd).stdout.trim();
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

// Append-only record of what the orchestrator did in this tab, for `log`.
const journalFile = (tab) => stateFile(tab).replace(/\.json$/, ".jsonl");

function journal(tab, event) {
  mkdirSync(STATE_DIR, { recursive: true });
  appendFileSync(journalFile(tab), `${JSON.stringify({ t: new Date().toISOString(), ...event })}\n`);
}

// herdr reports one size for every tab: that of the terminal showing this server, or
// a fixed fallback (120x40 by default) while none does, such as while the herdr client
// shows another machine. Panes keep their ratios, and every worker was at least
// MIN_WIDTH x MIN_HEIGHT when it opened, so smaller workers mean herdr reports less
// than the layout was made for: plan on the smallest size at which they fit again.
function readLayout(orchestrator, slots) {
  const layout = result(["pane", "layout", "--pane", orchestrator]).layout;
  const workers = layout.panes.filter((p) => slots.includes(p.pane_id));
  const sx = Math.max(1, ...workers.map((p) => MIN_WIDTH / p.rect.width));
  const sy = Math.max(1, ...workers.map((p) => MIN_HEIGHT / p.rect.height));
  const scale = (r) => ({ x: r.x * sx, y: r.y * sy, width: r.width * sx, height: r.height * sy });
  return {
    ...layout,
    reported: layout.area,
    area: scale(layout.area),
    panes: layout.panes.map((p) => ({ ...p, rect: scale(p.rect) })),
  };
}

const sizeText = ({ width, height }) => `${Math.round(width)}x${Math.round(height)}`;

// Read the caller's tab, its layout and this script's live slots in it.
function openTab() {
  if (process.env.HERDR_ENV !== "1") die("not running inside a herdr pane");
  const orchestrator = process.env.HERDR_PANE_ID;
  const tab = process.env.HERDR_TAB_ID;
  let state = { slots: [], reports: {} };
  try {
    state = JSON.parse(readFileSync(stateFile(tab), "utf8"));
  } catch {}
  if (state.slots.includes(orchestrator)) die("this pane is a herdr-orch worker; only the orchestrator pane runs orch");
  const layout = readLayout(orchestrator, state.slots);
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

// How far a pane's shape is from the minimum pane's shape.
const shapeGap = (width, height) => Math.abs(Math.log(width / height / (MIN_WIDTH / MIN_HEIGHT)));

// Choose the grid for this tab size: the most panes (up to MAX_WORKERS plus the
// orchestrator) that keep every pane at least MIN_WIDTH x MIN_HEIGHT, then the
// fewest empty cells, then cells closest to the minimum pane's shape.
function fitGrid(area) {
  let best = { rows: 1, cols: 1, panes: 1 };
  for (let rows = 1; rows <= Math.floor(area.height / MIN_HEIGHT); rows++) {
    for (let cols = 1; cols <= Math.floor(area.width / MIN_WIDTH); cols++) {
      const panes = Math.min(rows * cols, MAX_WORKERS + 1);
      const cells = rows * cols;
      const gap = shapeGap(area.width / cols, area.height / rows);
      const bestCells = best.rows * best.cols;
      if (panes > best.panes || (panes === best.panes &&
          (cells < bestCells || (cells === bestCells && gap < shapeGap(area.width / best.cols, area.height / best.rows))))) {
        best = { rows, cols, panes };
      }
    }
  }
  return best;
}

// Pick the pane to split so the tab fills toward the grid.
function nextSplit(orchestrator, slots, layout, grid) {
  const colWidth = layout.area.width / grid.cols;
  const rowHeight = layout.area.height / grid.rows;
  const rects = new Map(layout.panes.map((p) => [p.pane_id, p.rect]));
  const cells = (pane) => {
    const r = rects.get(pane);
    return [Math.round(r.width / colWidth), Math.round(r.height / rowHeight)];
  };
  // A pane spanning several cells splits off one cell, if that cell stays above the minimum.
  const wideFits = (p) => cells(p)[0] > 1 && rects.get(p).width / cells(p)[0] >= MIN_WIDTH;
  const tallFits = (p) => cells(p)[1] > 1 && rects.get(p).height / cells(p)[1] >= MIN_HEIGHT;
  const workers = slots.filter((p) => rects.has(p));
  const wide = workers.filter(wideFits);
  if (wide.length) {
    const pane = wide.reduce((a, b) => (cells(b)[0] > cells(a)[0] ? b : a));
    return [pane, "right", 1 / cells(pane)[0]];
  }
  const tall = workers.filter(tallFits);
  if (tall.length) {
    const pane = tall.reduce((a, b) => (rects.get(b).x < rects.get(a).x ? b : a));
    return [pane, "down", 1 / cells(pane)[1]];
  }
  if (wideFits(orchestrator)) return [orchestrator, "right", 1 / cells(orchestrator)[0]];
  if (tallFits(orchestrator)) return [orchestrator, "down", 1 / cells(orchestrator)[1]];
  // Panes laid out for another tab size may not match the grid: halve the largest
  // pane that stays at least the minimum size, keeping the orchestrator for last.
  const area = (p) => rects.get(p).width * rects.get(p).height;
  for (const pane of [...workers.sort((a, b) => area(b) - area(a)), orchestrator]) {
    const { width, height } = rects.get(pane);
    const options = [["right", width / 2, height], ["down", width, height / 2]]
      .filter(([, w, h]) => w >= MIN_WIDTH && h >= MIN_HEIGHT)
      .sort((a, b) => shapeGap(a[1], a[2]) - shapeGap(b[1], b[2]));
    if (options.length) return [pane, options[0][0], 0.5];
  }
  return null;
}

function loadWorktrees() {
  try {
    return JSON.parse(readFileSync(WORKTREES_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveWorktrees(trees) {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(WORKTREES_FILE, `${JSON.stringify(trees, null, 2)}\n`);
}

// The main checkout of the repository that contains dir.
const repoRoot = (dir) => dirname(gitOut(["rev-parse", "--path-format=absolute", "--git-common-dir"], dir));

// Create ../<repo>-<name> on a new branch <name>, or reuse the one orch made earlier.
function addWorktree(name, dir, base) {
  const root = repoRoot(dir);
  const path = join(dirname(root), `${basename(root)}-${name}`);
  const trees = loadWorktrees();
  if (trees[path]) {
    if (!existsSync(path)) die(`${path} was removed outside orch; run worktrees to drop it`);
    return { path, created: false };
  }
  if (existsSync(path)) die(`${path} already exists and orch did not create it`);
  if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${name}`], root, { check: false }).status === 0) {
    die(`branch ${name} already exists; choose another worker name`);
  }
  let from = base || gitOut(["rev-parse", "--abbrev-ref", "HEAD"], dir);
  if (from === "HEAD") from = gitOut(["rev-parse", "HEAD"], dir);
  git(["worktree", "add", "-q", "-b", name, path, from], root);
  trees[path] = { repo: root, branch: name, base: from };
  saveWorktrees(trees);
  return { path, created: true };
}

// Report the worktrees orch made in this repository; with clean, remove the
// merged ones that no agent uses, and delete their branches.
function worktrees(values) {
  const t = openTab();
  const root = repoRoot(process.cwd());
  const trees = loadWorktrees();
  const live = new Set(gitOut(["worktree", "list", "--porcelain"], root).split("\n")
    .filter((l) => l.startsWith("worktree ")).map((l) => l.slice(9)));
  const agents = result(["agent", "list"]).agents;
  const lines = [];
  for (const [path, w] of Object.entries(trees)) {
    if (w.repo !== root) continue;
    if (!live.has(path)) {
      delete trees[path];
      lines.push(`${path}: no longer a worktree; dropped from the list`);
      continue;
    }
    const target = values.base || w.base;
    const user = agents.find((a) => a.cwd === path || a.cwd?.startsWith(path + sep));
    const count = git(["rev-list", "--count", `${target}..${w.branch}`], root, { check: false });
    let state;
    if (user) state = `in use by ${user.name || user.pane_id}`;
    else if (gitOut(["status", "--porcelain"], path)) state = "uncommitted changes";
    else if (count.status !== 0) state = `cannot compare with ${target}`;
    else if (Number(count.stdout) > 0) state = `${Number(count.stdout)} commit${Number(count.stdout) === 1 ? "" : "s"} not in ${target}`;
    else if (!values.clean) state = `merged into ${target}; --clean removes it`;
    else {
      const removed = git(["worktree", "remove", path], root, { check: false });
      if (removed.status !== 0) {
        state = `merged, but remove failed: ${String(removed.stderr).trim()}`;
      } else {
        // Every commit of the branch is in target, so deleting it loses nothing.
        git(["branch", "-D", w.branch], root, { check: false });
        delete trees[path];
        journal(t.tab, { event: "worktree", action: "remove", path, branch: w.branch });
        state = `merged into ${target}; removed with its branch`;
      }
    }
    lines.push(`${path} (${w.branch}): ${state}`);
  }
  saveWorktrees(trees);
  console.log(lines.length ? lines.join("\n") : "no worktrees made by orch in this repository");
}

function spawnWorker(positionals, values, extra) {
  const [name, kind] = positionals;
  if (!name || !kind) die("usage: spawn <name> <kind> [--cwd DIR] [--mcp] [-- agent args]");
  if (!NAME_RE.test(name)) die("name must match [a-z][a-z0-9_-]{0,31}");
  if (agentExists(name)) die(`agent ${name} already exists`);
  if (values.base && !values.worktree) die("--base needs --worktree");
  let cwd = resolve(values.cwd || process.cwd());
  const t = openTab();
  if (values.worktree) {
    const tree = addWorktree(name, cwd, values.base);
    cwd = tree.path;
    if (tree.created) journal(t.tab, { event: "worktree", action: "add", path: tree.path, branch: name });
  }
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
      t.layout = readLayout(t.orchestrator, t.state.slots);
    }
    const grid = fitGrid(t.layout.area);
    const { width } = t.layout.area;
    const size = sizeText(t.layout.area);
    const fits = grid.panes - 1;
    if (!fits) die(`this ${size} tab is too small for a worker; panes need ${MIN_WIDTH}x${MIN_HEIGHT} (ORCH_MIN_PANE). If the terminal is larger, no terminal shows this herdr server right now (detached, or the herdr client shows another machine) and herdr reports a fallback size; spawn again once it shows this tab`);
    if (t.state.slots.length >= fits) die(`no room for another worker: this ${size} tab fits ${fits}; stop one first`);
    let split = nextSplit(t.orchestrator, t.state.slots, t.layout, grid);
    const orchestratorWidth = t.layout.panes.find((p) => p.pane_id === t.orchestrator).rect.width;
    if (!split && orchestratorWidth - width / grid.cols >= 1) {
      // After the tab grows, scaled panes can be too narrow to halve; hand the
      // orchestrator's extra width to the workers and try again.
      const amount = (orchestratorWidth - width / grid.cols) / width;
      herdr(["pane", "resize", "--pane", t.orchestrator, "--direction", "left", "--amount", amount.toFixed(4)], { check: false });
      t.layout = readLayout(t.orchestrator, t.state.slots);
      split = nextSplit(t.orchestrator, t.state.slots, t.layout, grid);
    }
    if (!split) die("no pane is large enough to split; stop workers and run close so new panes follow the tab size");
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
  const event = { event: "spawn", name, kind, pane, cwd };
  if (proc.status !== 0) {
    const error = errorText(proc);
    journal(t.tab, { ...event, error });
    if (!error.startsWith("agent_not_ready")) die(`${error} (pane ${pane} is left as a free slot)`);
    // Blocked at startup, for example by a folder trust prompt; show it to the caller.
    const screen = herdr(["agent", "read", name, "--source", "visible"], { check: false }).stdout;
    console.error(screen.split(/\r?\n/).filter((l) => l.trim()).slice(-15).join("\n"));
    die(`${error}; answer with herdr agent send-keys ${name} <keys>, or ask the user`);
  }
  journal(t.tab, event);
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
  const firstLine = text.split(/\r?\n/).find((l) => l.trim())?.trim() || "";
  const event = { event: "send", name, prompt: firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine, report };
  if (proc.status !== 0) {
    const error = errorText(proc);
    if (error.startsWith("agent_blocked") || error.startsWith("agent_not_found")) {
      journal(t.tab, { ...event, error, failed: true });
      die(error);
    }
    // A timeout or stall does not prove the prompt was lost; keep the report path for wait.
    event.error = error;
    console.error(`orch: ${error}; inspect ${name} before sending again`);
  }
  journal(t.tab, event);
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
    const written = Boolean(r.report && existsSync(r.report));
    journal(t.tab, { event: "result", name: r.name, status: r.status, report: r.report, written });
    if (r.status === "blocked") {
      // The user has to answer the dialog, so make sure they see it.
      herdr(["notification", "show", `${r.name} needs input`, "--body",
        "A herdr-orch worker is waiting at an approval or question.", "--sound", "request"], { check: false });
    }
    console.log(`${summary(r, lines)}\n`);
    if (!written) ok = false;
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
    const stopped = waitUntil(gone, 5000);
    journal(t.tab, { event: "stop", name, stopped });
    if (stopped) {
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
  journal(t.tab, { event: "close", closed: t.state.slots.length - kept.length, kept: kept.length });
  t.state.slots = kept;
  saveState(t.tab, t.state);
}

const clock = (iso) => new Date(iso).toTimeString().slice(0, 8);

function eventLine(e) {
  const at = clock(e.t);
  switch (e.event) {
    case "spawn": return `${at} spawn ${e.name} ${e.kind} in ${e.cwd}${e.error ? ` failed: ${e.error}` : ""}`;
    case "send": return `${at} send ${e.name}: ${e.prompt}${e.error ? ` (${e.error})` : ""}`;
    case "result": return `${at} result ${e.name}: ${e.status}${e.written ? "" : ", no report"}`;
    case "stop": return `${at} stop ${e.name}${e.stopped ? "" : " failed"}`;
    case "close": return `${at} close: ${e.closed} closed, ${e.kept} kept`;
    case "worktree": return `${at} worktree ${e.action} ${e.path} (${e.branch})`;
    default: return `${at} ${e.event}`;
  }
}

// Print the tab's latest run and, for each worker's last prompt, what is still open.
function showLog(values) {
  const t = openTab();
  const file = journalFile(t.tab);
  let events = [];
  try {
    events = readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {}
  if (!events.length) die("no journal for this tab yet");
  // A close that leaves no slots ends a run.
  let start = 0;
  events.forEach((e, i) => {
    if (e.event === "close" && e.kept === 0 && i < events.length - 1) start = i + 1;
  });
  const run = events.slice(start);
  const limit = Number(values.lines || 40);
  const d = new Date(run[0].t);
  console.log(`journal: ${file}`);
  console.log(`run since ${d.toDateString()} ${clock(run[0].t)}. Past actions only: check git and the reports before acting on them.`);
  if (run.length > limit) console.log(`(${run.length - limit} earlier events omitted)`);
  for (const e of run.slice(-limit)) console.log(eventLine(e));

  const last = new Map();
  for (const e of run) {
    if (e.event === "send" && !e.failed) last.set(e.name, { report: e.report, collected: false });
    if (e.event === "result" && e.written && last.has(e.name)) last.get(e.name).collected = true;
  }
  const open = [...last].filter(([, s]) => !s.collected).map(([name, { report }]) => {
    if (existsSync(report)) return `${name}: finished, report not read yet: ${report}`;
    const agent = herdr(["agent", "get", name], { check: false });
    if (agent.status !== 0) return `${name}: exited without a report`;
    const status = JSON.parse(agent.stdout).result.agent.agent_status;
    if (status === "working") return `${name}: still working; run wait ${name}`;
    if (status === "blocked") return `${name}: blocked at an approval or question; ask the user`;
    return `${name}: ${status} without a report; read its screen`;
  });
  if (open.length) console.log(`\nopen:\n${open.join("\n")}`);
}

// Lessons kept across runs: one file per project, keyed by its git remote or
// checkout path, and one for all projects. The orchestrator edits them.
function showLessons() {
  const git = (args) => spawnSync("git", args, { encoding: "utf8" }).stdout?.trim();
  const project = git(["remote", "get-url", "origin"]) || git(["rev-parse", "--show-toplevel"]);
  const dir = join(STATE_DIR, "lessons");
  mkdirSync(dir, { recursive: true });
  const files = [["all projects", join(dir, "global.md")]];
  if (project) files.unshift([project, join(dir, `${createHash("sha1").update(project).digest("hex").slice(0, 12)}.md`)]);
  for (const [scope, file] of files) {
    if (!existsSync(file)) writeFileSync(file, `# herdr-orch lessons: ${scope}\n`);
    const body = readFileSync(file, "utf8").split(/\r?\n/).slice(1).join("\n").trim();
    console.log(`lessons for ${scope}: ${file}\n${body || "(none yet)"}\n`);
  }
}

// Offer the rule once; remember the user's answer so it is not asked again.
function setup(positionals) {
  const [action, file] = positionals;
  let decision = {};
  try {
    decision = JSON.parse(readFileSync(SETUP_FILE, "utf8"));
  } catch {}
  const record = (d) => {
    mkdirSync(STATE_DIR, { recursive: true });
    writeFileSync(SETUP_FILE, `${JSON.stringify({ ...d, at: new Date().toISOString() }, null, 2)}\n`);
  };
  if (!action) {
    console.log(`rule:\n${RULE}\n`);
    if (decision.declined) console.log(`status: the user declined on ${decision.at.slice(0, 10)}; do not ask again`);
    else if (decision.file) console.log(`status: added to ${decision.file} on ${decision.at.slice(0, 10)}; if it is gone, the user removed it, so do not ask again`);
    else console.log("status: not decided; ask the user once whether to add the rule to their global instructions");
    return;
  }
  if (action === "decline") {
    record({ declined: true });
    console.log("declined; setup will report this instead of suggesting the rule");
    return;
  }
  if (action !== "add" || !file) die("usage: setup [add <file> | decline]");
  const path = resolve(file.replace(/^~(?=$|[\\/])/, homedir()));
  const text = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (text.includes(RULE_MARK)) {
    console.log(`${path} already has the rule`);
  } else {
    mkdirSync(dirname(path), { recursive: true });
    const gap = !text || text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
    appendFileSync(path, `${gap}## herdr-orch\n\n${RULE}\n`);
    console.log(`added the rule to ${path}`);
  }
  record({ file: path });
}

function listSlots() {
  const t = openTab();
  const agents = agentsByPane();
  const grid = fitGrid(t.layout.area);
  const size = sizeText(t.layout.area);
  const reported = sizeText(t.layout.reported);
  const note = size === reported ? "" : `; herdr reports ${reported}, less than the workers were made for`;
  console.log(`${t.state.slots.length}/${grid.panes - 1} slots (${grid.rows} rows x ${grid.cols} columns for a ${size} tab${note})`);
  for (const pane of t.state.slots) {
    const a = agents.get(pane);
    if (a) console.log(`${pane}  ${a.name || "-"}  ${a.agent}  ${a.agent_status}`);
    else console.log(`${pane}  ${isFree(pane, agents) ? "free" : "busy (no agent)"}`);
  }
}

function main() {
  if (!(MAX_WORKERS >= 1)) die("ORCH_MAX_WORKERS must be a positive number");
  if (!(MIN_WIDTH >= 1 && MIN_HEIGHT >= 1)) die("ORCH_MIN_PANE must look like 80x24");
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
        worktree: { type: "boolean" },
        base: { type: "string" },
        clean: { type: "boolean" },
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
    case "worktrees": return worktrees(values);
    case "log": return showLog(values);
    case "lessons": return showLessons();
    case "setup": return setup(positionals);
    case "stop": return stopWorkers(positionals, values);
    case "close": return closeSlots(values);
    default: die(`unknown command ${command}\n${USAGE}`);
  }
}

main();
