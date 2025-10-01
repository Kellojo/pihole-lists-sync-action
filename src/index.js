const core = require("@actions/core");
const axios = require("axios");
const https = require("https");
const fs = require("fs");

core.info("Starting Pi-hole blocklist sync...");

const piholeUrl = core.getInput("pihole-url", { required: true });
const piholePassword = core.getInput("pihole-app-password", {
  required: true,
});
const blocklistFile = core.getInput("blocklist-file", { required: true });
const allowSelfSigned = core.getInput("allow-self-signed-certs") === "true";

core.info(`🌐 Pi-hole URL: ${piholeUrl}`);
core.info(`📁 Blocklist File: ${blocklistFile}`);
core.info(`🔓 Allow Self-Signed Certificates: ${allowSelfSigned}`);
core.info("");

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: !allowSelfSigned,
  }),
  timeout: 30000,
});

async function run() {
  try {
    const sid = await authenticateWithPihole();
    const existingLists = await fetchListsFromPihole(sid);
    await deleteExistingLists(sid, existingLists);

    const blocklistUrls = await getBlocklistUrlsFromConfig();

    await addBlocklists(sid, blocklistUrls);

    core.info("✅ Pi-hole blocklist sync completed successfully");
  } catch (error) {
    core.error("Error occurred:", error.message);
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

async function authenticateWithPihole() {
  core.info(`Authenticating with Pi-hole`);
  const authResponse = await axiosInstance.post(`${piholeUrl}/auth`, {
    password: piholePassword,
  });
  if (authResponse.status !== 200) {
    throw new Error(
      `Authentication failed with status: ${authResponse.status} - ${authResponse.statusText}`
    );
  }
  const { session } = authResponse.data;
  core.info(
    `Authentication successful - valid for ${session.validity} seconds`
  );
  core.info("");
  return session.sid;
}

async function fetchListsFromPihole(sid) {
  core.info(`Fetching lists via API`);
  const blocklistResponse = await axiosInstance.get(`${piholeUrl}/lists`, {
    headers: {
      sid: sid,
    },
  });

  if (blocklistResponse.status !== 200) {
    throw new Error(
      `Failed to fetch lists with status: ${blocklistResponse.status} - ${blocklistResponse.statusText}`
    );
  }

  const { lists } = await blocklistResponse.data;
  core.info(`Found ${lists.length} lists configured in Pi-hole`);
  core.info("");

  return lists;
}

async function deleteExistingLists(sid, lists) {
  if (lists.length === 0) return;
  core.info(`Deleting existing lists`);

  const requestBody = lists.map((list) => {
    return {
      item: list.address,
      type: list.type,
    };
  });

  const deleteResponse = await axiosInstance.post(
    `${piholeUrl}/lists:batchDelete`,
    {
      headers: {
        sid: sid,
      },
      data: requestBody,
    }
  );
  if (deleteResponse.status !== 200) {
    core.error(`Failed to delete existing lists`);
    console.info(JSON.stringify(deleteResponse.data, null, 2));
    throw new Error(
      `Failed to delete lists with status: ${deleteResponse.status} - ${deleteResponse.statusText}`
    );
  }

  core.info(`All existing lists removed`);
  core.info("");
}

async function getBlocklistUrlsFromConfig() {
  core.info(`Reading blocklist URLs from file: ${blocklistFile}`);
  if (!fs.existsSync(blocklistFile)) {
    throw new Error(`Blocklist file not found: ${blocklistFile}`);
  }

  const blocklistUrls = fs
    .readFileSync(blocklistFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  core.info(`Found ${blocklistUrls.length} URLs in blocklist file`);
  return blocklistUrls;
}

async function addBlocklists(sid, blocklistUrls) {
  core.info(`Adding ${blocklistUrls.length} blocklists to Pi-hole`);
  for (const url of blocklistUrls) {
    core.info(`Adding ${url}`);
    await axiosInstance.post(
      `${piholeUrl}/lists`,
      {
        address: url,
        type: "block",
      },
      {
        headers: {
          sid: sid,
        },
      }
    );
  }
  core.info(`All blocklists added`);
  core.info("");
}

run();
