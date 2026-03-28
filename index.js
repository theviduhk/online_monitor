import fetch from 'node-fetch';

const GRAFANA_URL = 'https://monitor.trax-cloud.com/api/datasources/proxy/29/render';
const SESSION_ID = process.env.GRAFANA_SESSION;
const FIREBASE_BASE_URL = process.env.FIREBASE_URL;

const PROJECTS = [
  "pgpl", "diageotz", "beiersdorfde"
];

const METRICS = [
  { path: "validation", name: "validation" },
  { path: "voting", name: "voting" },
  { path: "stitching", name: "stitching" },
  { path: "offline_pricing", name: "offline pricing" }
];

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
        oldestTask: null,
        lastUpdated: timestamp
      };
    }

    if (isOldest) {
      projectData[metricName].oldestTask = value;
    } else {
      projectData[metricName].current = value;
    }
  }

  return projectData;
}

async function main() {

  const finalData = {};

  for (const project of PROJECTS) {
    try {
      const data = await updateProject(project);
      finalData[project] = data;
      console.log(`✅ ${project} done`);
    } catch (err) {
      console.error(`❌ ${project}`, err.message);
    }
  }

  // 🔥 SINGLE FILE UPDATE
  const firebaseUrl = `${FIREBASE_BASE_URL}rthevidu_online.json`;

  const fbResponse = await fetch(firebaseUrl, {
    method: 'PUT', // overwrite whole file
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalData)
  });

  if (!fbResponse.ok) {
    throw new Error(`Firebase failed`);
  }

  console.log("🚀 Firebase updated (single file)");
}

main().catch(console.error);
