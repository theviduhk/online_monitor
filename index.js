import fetch from 'node-fetch';

const GRAFANA_URL = 'https://monitor.trax-cloud.com/api/datasources/proxy/29/render';
const SESSION_ID = process.env.GRAFANA_SESSION;
const FIREBASE_BASE_URL = process.env.FIREBASE_URL;

const PROJECTS = [
  "beiersdorfde", "beiersdorfes", "beiersdorfkz", "beiersdorfpt", "beiersdorfru",
  "beiersdorfse", "beiersdorftr", "beiersdorfuae", "beiersdorfuk", "cbcil",
  "danoneuk", "diageoes", "diageotz", "gskuz", "gskgr", "gskhu", "gsklt",
  "haleonaesa", "haleongb", "haleonse", "marspl", "marssa", "mondelezkaza",
  "mondelezno", "mdlzrusf", "mondelezsa", "mondelezuz", "pepsicouk",
  "pernodricardes", "pgbaltics", "pgcz", "pges", "pgespharma", "pghr",
  "pghu", "pgpl", "pgpt", "pgza", "schwartaude", "ulbe", "ulnl", "ulpt","cbcdairyil","inbevci","inbevnl","marsbh",
  "marskw" , "marsom" , "marsqa" , "marsuae" , "risparkwinede" , "straussdryil" , "straussil" , "straussfritolayil",
  "tevade" , "tevapl" , "tevaru" ,
];

const METRICS = [
  { path: "validation", name: "validation" },
  { path: "offline_posm", name: "offline posm" },
  { path: "voting", name: "voting" },
  { path: "stitching", name: "stitching" },
  { path: "Pricing_voting", name: "Pricing voting" },
  { path: "offline_pricing", name: "offline pricing" },
  { path: "Offline_Pricing_Voting", name: "Pricing voting" },
  { path: "scene_recognition", name: "scene recognition" },
  { path: "category_expert", name: "category expert" },
  { path: "offline_validation", name: "offline validation" },
  { path: "pricing_voting", name: "Pricing voting" },
  { path: "voting_engine", name: "Engine Voting" },
  { path: "offline_voting", name: "offline voting" }
];


// 🔹 Convert seconds → human readable
function formatDuration(seconds) {
  seconds = Number(seconds);
  if (isNaN(seconds)) return null;

  if (seconds < 60) return `${seconds}s`;

  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  if (minutes < 60) return `${minutes}m ${secs}s`;

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours < 24) return `${hours}h ${mins}m`;

  const days = Math.floor(hours / 24);
  const hrs = hours % 24;
  if (days < 7) return `${days}d ${hrs}h`;

  const weeks = Math.floor(days / 7);
  const remainingDays = days % 7;
  return `${weeks}w ${remainingDays}d`;
}


// 🔹 Get existing Firebase data
async function getExistingData() {
  const url = `${FIREBASE_BASE_URL}queue_monitor.json`;

  try {
    const res = await fetch(url);
    if (!res.ok) return {};
    return await res.json() || {};
  } catch {
    return {};
  }
}


// 🔹 Fetch Grafana data per project
async function updateProject(project) {

  const payload = METRICS.flatMap(m => ([
    `target=alias(prod.gauges.selector.queue.${m.path}.${project}.total,'${m.name} - Total')`,
    `target=alias(aliasByNode(prod.gauges.selector.queue.${m.path}.${project}.oldestTask,4),'${m.name} - Oldest Task')`
  ])).join("&") + "&from=-1h&until=now&format=json";

  const response = await fetch(GRAFANA_URL, {
    method: 'POST',
    headers: {
      'Cookie': `grafana_session=${SESSION_ID}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(`Grafana request failed for ${project}`);
  }

  const json = await response.json();
  const projectData = {};

  for (const series of json) {
    const validPoints = series.datapoints.filter(dp => dp[0] !== null);
    const last = validPoints.pop();
    if (!last) continue;

    const value = String(last[0]);
    const timestamp = new Date(last[1] * 1000).toISOString();

    const isOldest = series.target.includes("Oldest Task");

    const metricName = series.target
      .replace(" - Total", "")
      .replace(" - Oldest Task", "");

    if (!projectData[metricName]) {
      projectData[metricName] = {
        current: null,
        duration: null,
        durationRaw: null,
        lastUpdated: timestamp
      };
    }

    if (isOldest) {
      projectData[metricName].duration = formatDuration(value);
      projectData[metricName].durationRaw = value;
    } else {
      projectData[metricName].current = value;
    }
  }

  return projectData;
}


// 🔹 Main logic
async function main() {

  const existingData = await getExistingData();
  const finalData = {};

  for (const project of PROJECTS) {
    try {
      const newData = await updateProject(project);
      const oldProjectData = existingData?.[project] || {};

      const mergedProjectData = {};

      for (const metric in newData) {

        const newMetric = newData[metric];
        const oldMetric = oldProjectData?.[metric] || {};

        let previous = oldMetric.previous || null;

        // 🔥 Detect change
        if (
          oldMetric.current &&
          newMetric.current &&
          oldMetric.current !== newMetric.current
        ) {
          previous = oldMetric.current;
        }

        mergedProjectData[metric] = {
          current: newMetric.current,
          duration: newMetric.duration,
          durationRaw: newMetric.durationRaw,
          previous: previous,
          lastUpdated: newMetric.lastUpdated
        };
      }

      finalData[project] = mergedProjectData;

      console.log(`✅ ${project} updated`);

    } catch (err) {
      console.error(`❌ Error in ${project}:`, err.message);
    }
  }

  // 🔹 Push to Firebase
  const firebaseUrl = `${FIREBASE_BASE_URL}queue_monitor.json`;

  const fbResponse = await fetch(firebaseUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalData)
  });

  if (!fbResponse.ok) {
    throw new Error(`Firebase update failed`);
  }

  console.log("🚀 Firebase updated");
}


// 🔹 5 SECOND LOOP
async function runLoop() {
  console.log("🚀 Starting loop (every 5 seconds)");

  while (true) {
    try {
      await main();
    } catch (err) {
      console.error("❌ Loop error:", err.message);
    }

    console.log("⏳ Waiting 5 seconds...");
    await new Promise(res => setTimeout(res, 5000));
  }
}


// 🔹 Start
runLoop();
