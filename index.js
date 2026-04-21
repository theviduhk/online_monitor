import fetch from "node-fetch";

const GRAFANA_URL =
  "https://monitor-public.trax-cloud.com/api/datasources/proxy/29/render";

const SESSION_ID = process.env.GRAFANA_SESSION;
const FIREBASE_BASE_URL = process.env.FIREBASE_URL;

// 🔥 Reduce load (IMPORTANT)
const LOOP_DELAY = 10000; // 10 seconds
const CONCURRENT_LIMIT = 5; // parallel requests

const PROJECTS = [
  "beiersdorfde","beiersdorfes","beiersdorfkz","beiersdorfpt","beiersdorfru",
  "beiersdorfse","beiersdorftr","beiersdorfuae","beiersdorfuk","cbcil",
  "danoneuk","diageoes","diageotz","gskuz","gskgr","gskhu","gsklt",
  "haleonaesa","haleongb","haleonse","marspl","marssa","mondelezkaza",
  "mondelezno","mdlzrusf","mondelezsa","mondelezuz","pepsicouk",
  "pernodricardes","pgbaltics","pgcz","pges","pgespharma","pghr",
  "pghu","pgpl","pgpt","pgza","schwartaude","ulbe","ulnl","ulpt",
  "cbcdairyil","inbevci","inbevnl","marsbh","marskw","marsom",
  "marsqa","marsuae","risparkwinede","straussdryil","straussil",
  "straussfritolayil","tevade","tevapl","bdftr","pngza2","beiersdorfsp","dlcpt","tevaru"
];

// 🔥 Cleaned metrics (removed duplicates)
const METRICS = [
  { path: "validation", name: "validation" },
  { path: "offline_posm", name: "offline posm" },
  { path: "voting", name: "voting" },
  { path: "stitching", name: "stitching" },
  { path: "pricing_voting", name: "pricing voting" },
  { path: "offline_pricing", name: "offline pricing" },
  { path: "scene_recognition", name: "scene recognition" },
  { path: "category_expert", name: "category expert" },
  { path: "offline_validation", name: "offline validation" },
  { path: "voting_engine", name: "engine voting" },
  { path: "offline_voting", name: "offline voting" }
];

// 🔹 Format duration
function formatDuration(seconds) {
  seconds = Number(seconds);
  if (isNaN(seconds)) return null;

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// 🔹 Firebase existing data
async function getExistingData() {
  try {
    const res = await fetch(`${FIREBASE_BASE_URL}queue_monitor.json`);
    return res.ok ? (await res.json()) || {} : {};
  } catch {
    return {};
  }
}

// 🔹 Fetch one project
async function updateProject(project) {
  const payload =
    METRICS.flatMap((m) => [
      `target=alias(prod.gauges.selector.queue.${m.path}.${project}.total,'${m.name} - Total')`,
      `target=alias(aliasByNode(prod.gauges.selector.queue.${m.path}.${project}.oldestTask,4),'${m.name} - Oldest Task')`
    ]).join("&") + "&from=-5m&until=now&format=json";

  const res = await fetch(GRAFANA_URL, {
    method: "POST",
    headers: {
      Cookie: `grafana_session=${SESSION_ID}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: payload
  });

  if (!res.ok) throw new Error(`Grafana failed (${project})`);

  const json = await res.json();
  const data = {};

  for (const series of json) {
    const valid = series.datapoints.filter((d) => d[0] !== null);
    if (!valid.length) continue;

    const [value, ts] = valid.pop();

    const isOldest = series.target.includes("Oldest Task");

    const name = series.target
      .replace(" - Total", "")
      .replace(" - Oldest Task", "");

    if (!data[name]) {
      data[name] = {
        current: null,
        duration: null,
        durationRaw: null,
        lastUpdated: new Date(ts * 1000).toISOString()
      };
    }

    if (isOldest) {
      data[name].duration = formatDuration(value);
      data[name].durationRaw = value;
    } else {
      data[name].current = value;
    }
  }

  return data;
}

// 🔹 Parallel runner with limit
async function runWithLimit(items, limit, handler) {
  const results = [];
  const executing = [];

  for (const item of items) {
    const p = Promise.resolve().then(() => handler(item));
    results.push(p);

    if (limit <= items.length) {
      const e = p.then(() => executing.splice(executing.indexOf(e), 1));
      executing.push(e);

      if (executing.length >= limit) {
        await Promise.race(executing);
      }
    }
  }

  return Promise.allSettled(results);
}

// 🔹 Main
async function main() {
  const existing = await getExistingData();
  const updates = {};

  const results = await runWithLimit(
    PROJECTS,
    CONCURRENT_LIMIT,
    async (project) => {
      try {
        const newData = await updateProject(project);
        const oldData = existing[project] || {};

        let changed = false;
        const merged = {};

        for (const metric in newData) {
          const newM = newData[metric];
          const oldM = oldData[metric] || {};

          let previous = oldM.previous || null;

          if (
            oldM.current &&
            newM.current &&
            oldM.current !== newM.current
          ) {
            previous = oldM.current;
            changed = true;
          }

          merged[metric] = {
            ...newM,
            previous
          };
        }

        if (changed || !existing[project]) {
          updates[project] = merged;
          console.log(`🔄 ${project}`);
        }
      } catch (err) {
        console.error(`❌ ${project}:`, err.message);
      }
    }
  );

  if (Object.keys(updates).length) {
    const res = await fetch(`${FIREBASE_BASE_URL}queue_monitor.json`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates)
    });

    if (!res.ok) throw new Error("Firebase update failed");

    console.log("🚀 Firebase updated");
  } else {
    console.log("✅ No changes");
  }
}

// 🔹 Loop
async function runLoop() {
  console.log("🚀 Loop started");

  while (true) {
    try {
      await main();
    } catch (err) {
      console.error("❌ Loop:", err.message);
    }

    await new Promise((r) => setTimeout(r, LOOP_DELAY));
  }
}

runLoop();
