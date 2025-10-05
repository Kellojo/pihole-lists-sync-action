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
const localDnsCnameFile = core.getInput("local-dns-cname-file");
const localDnsFile = core.getInput("local-dns-file");

core.info(`🌐 Pi-hole URL: ${piholeUrl}`);
core.info(`📁 Blocklist File: ${blocklistFile}`);
core.info(`🔓 Allow Self-Signed Certificates: ${allowSelfSigned}`);
if (localDnsFile) core.info(`📁 Local DNS File: ${localDnsFile}`);
if (localDnsCnameFile)
  core.info(`📁 Local DNS CNAME File: ${localDnsCnameFile}`);

core.info("");

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: !allowSelfSigned,
  }),
  timeout: 30000,
});

async function run() {
  try {
    await authenticateWithPihole();
    await applyLists();
    await applyLocalDnsSettings();
  } catch (error) {
    core.error("Error occurred:", error.message);
    core.setFailed(`Action failed with error: ${error.message}`);
  }

  logoutFromPihole();
}

async function authenticateWithPihole() {
  core.info(`🔑 Authenticating with Pi-hole`);
  const authResponse = await axiosInstance.post(`${piholeUrl}/auth`, {
    password: piholePassword,
  });
  if (authResponse.status !== 200) {
    throw new Error(
      `Authentication failed with status: ${authResponse.status} - ${authResponse.statusText}`
    );
  }
  const { session } = authResponse.data;
  const sid = session.sid;
  core.setSecret(sid);

  axiosInstance.defaults.headers.common["sid"] = sid;

  core.info(`Authentication successful, valid for ${session.validity} seconds`);
  core.info("");
}

async function applyLists() {
  const existingLists = await fetchListsFromPihole();
  await deleteExistingLists(existingLists);

  const blocklistUrls = await getBlocklistUrlsFromConfig();

  await addBlocklists(blocklistUrls);

  await updateGravity();
  core.info("✅ Pi-hole blocklist sync completed successfully");
}

async function fetchListsFromPihole() {
  core.info(`🛜 Fetching lists via API`);
  const blocklistResponse = await axiosInstance.get(`${piholeUrl}/lists`);

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

async function deleteExistingLists(lists) {
  if (lists.length === 0) return;
  core.info(`🗑️ Deleting existing lists`);

  const requestBody = lists.map((list) => {
    return {
      item: list.address,
      type: list.type,
    };
  });

  const deleteResponse = await axiosInstance.post(
    `${piholeUrl}/lists:batchDelete`,
    requestBody
  );
  if (![200, 204].includes(deleteResponse.status)) {
    core.error(`Failed to delete existing lists`);

    throw new Error(
      `Failed to delete lists with status: ${deleteResponse.status} - ${deleteResponse.statusText}`
    );
  }

  core.info(`All existing lists removed`);
  core.info("");
}

async function getBlocklistUrlsFromConfig() {
  core.info(`📄 Reading blocklist URLs from file: ${blocklistFile}`);
  if (!fs.existsSync(blocklistFile)) {
    throw new Error(`Blocklist file not found: ${blocklistFile}`);
  }

  const blocklistUrls = fs
    .readFileSync(blocklistFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  core.info(`Found ${blocklistUrls.length} URLs in blocklist file`);
  core.info("");
  return blocklistUrls;
}

async function addBlocklists(blocklistUrls) {
  core.info(`💾 Adding ${blocklistUrls.length} blocklists to Pi-hole`);
  for (const url of blocklistUrls) {
    core.info(`Adding ${url}`);
    await axiosInstance.post(`${piholeUrl}/lists`, {
      address: url,
      type: "block",
    });
  }
  core.info(`All blocklists added`);
  core.info("");
}

async function updateGravity() {
  core.info(`🔄 Updating Pi-hole gravity`);
  const gravityResponse = await axiosInstance.post(
    `${piholeUrl}/action/gravity`
  );
  if (gravityResponse.status !== 200) {
    throw new Error(
      `Failed to update gravity with status: ${gravityResponse.status} - ${gravityResponse.statusText}`
    );
  }

  core.info(`Gravity database updated successfully`);
  core.info("");
}

async function applyLocalDnsSettings() {
  if (!localDnsFile && !localDnsCnameFile) return;
  core.info("🔄 Updating local DNS records");
  const dnsConfig = await getDnsConfig();

  const localDnsRecords = await getLocalDnsRecords();
  if (localDnsRecords) {
    core.info(`💾 Adding local DNS records`);
    dnsConfig.hosts = localDnsRecords;
  }

  const localDnsCnameRecords = await getLocalDnsCnameRecords();
  if (localDnsCnameRecords) {
    core.info(`💾 Adding local DNS CNAME records`);
    dnsConfig.cnames = localDnsCnameRecords;
  }

  await updateDnsConfig(dnsConfig);
}

async function getDnsConfig() {
  core.info(`📡 Fetching DNS configuration`);
  const dnsResponse = await axiosInstance.get(`${piholeUrl}/config/dns`);
  if (dnsResponse.status !== 200) {
    throw new Error(
      `Failed to fetch DNS configuration with status: ${dnsResponse.status} - ${dnsResponse.statusText}`
    );
  }
  core.info(`DNS configuration fetched successfully`);
  core.info("");

  return dnsResponse.data.config.dns;
}

async function updateDnsConfig(dnsConfig) {
  core.info(`📡 Updating DNS configuration`);
  const updateResponse = await axiosInstance.post(`${piholeUrl}/config/dns`, {
    config: {
      dns: dnsConfig,
    },
  });
  if (updateResponse.status !== 200) {
    throw new Error(
      `Failed to update DNS configuration with status: ${updateResponse.status} - ${updateResponse.statusText}`
    );
  }
  core.info(`✅ DNS configuration updated successfully`);
  core.info("");
}

async function getLocalDnsRecords() {
  if (!localDnsFile) return null;

  core.info(`📄 Reading local DNS records from file: ${localDnsFile}`);
  if (!fs.existsSync(localDnsFile)) {
    throw new Error(`Local DNS file not found: ${localDnsFile}`);
  }

  const localDnsRecords = fs
    .readFileSync(localDnsFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  core.info(`Found ${localDnsRecords.length} local DNS records in file`);
  core.info("");
  return localDnsRecords;
}

async function getLocalDnsCnameRecords() {
  if (!localDnsCnameFile) return null;

  core.info(
    `📄 Reading local DNS CNAME records from file: ${localDnsCnameFile}`
  );
  if (!fs.existsSync(localDnsCnameFile)) {
    throw new Error(`Local DNS CNAME file not found: ${localDnsCnameFile}`);
  }
  const localDnsCnameRecords = fs
    .readFileSync(localDnsCnameFile, "utf-8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  core.info(
    `Found ${localDnsCnameRecords.length} local DNS CNAME records in file`
  );
  core.info("");
  return localDnsCnameRecords;
}

async function logoutFromPihole() {
  core.info("");
  try {
    core.info(`🔒 Logging out from Pi-hole`);
    await axiosInstance.delete(`${piholeUrl}/auth`);
    core.info(`Successfully logged out from Pi-hole`);
  } catch (error) {
    core.error(`Failed to log out from Pi-hole: ${error.message}`);
  }
}

run();
