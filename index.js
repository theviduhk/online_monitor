
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
  "pghu", "pgpl", "pgpt", "pgza", "schwartaude", "ulbe", "ulnl", "ulpt"
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

async function updateProject(project) {
  const payload = METRICS.flatMap(m => ([
  `target=alias(prod.gauges.selector.queue.${m.path}.${project}.total,'${m.name} - Total')`,
  `target=alias(aliasByNode(prod.gauges.selector.queue.${m.path}.${project}.oldestTask,4),'${m.name} - Oldest Task')`
])).join("&") + "&from=-1h&until=now&format=json";

  const response = await fetch(GRAFANA_URL, {
    method: 'POST',
    headers: {
      'Cookie': grafana_session=${SESSION_ID},
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: payload
  });

  if (!response.ok) {
    throw new Error(Grafana request failed for ${project}: ${response.status});
  }

  const json = await response.json();

  const batchData = {};
  for (const series of json) {
    const validPoints = series.datapoints.filter(dp => dp[0] !== null);
    const last = validPoints.pop();
    if (!last) continue;

    const timestamp = new Date(last[1] * 1000).toISOString();
    const metricName = series.target;

    batchData[metricName] = {
      current: String(last[0]),
      lastUpdated: timestamp
    };
  }

  const firebaseUrl = ${FIREBASE_BASE_URL}${project}.json;
  const fbResponse = await fetch(firebaseUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchData)
  });

  if (!fbResponse.ok) {
    throw new Error(Firebase update failed for ${project}: ${fbResponse.status});
  }

  console.log(✅ Updated: ${project});
}

async function main() {
  for (const project of PROJECTS) {
    try {
      await updateProject(project);
    } catch (err) {
      console.error(❌ Error in ${project}:, err.message);
    }
  }
  console.log("🚀 DONE");
}

main().catch(console.error);
