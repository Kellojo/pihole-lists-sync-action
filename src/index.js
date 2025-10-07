const core = require("@actions/core");
const axios = require("axios");
const axiosRetry = require("axios-retry").default;
const https = require("https");
const fs = require("fs");
const yaml = require("yaml");

core.info("Starting Pi-hole config sync...");
const piholeUrl = core.getInput("pihole-url", { required: true });
const piholePassword = core.getInput("pihole-app-password", {
  required: true,
});
const configFile = core.getInput("pihole-config-file", { required: true });
const allowSelfSigned = core.getInput("allow-self-signed-certs") === "true";

core.info(`🌐 Pi-hole URL: ${piholeUrl}`);
core.info(`📁 Pi-hole Config File: ${configFile}`);
core.info(`🔓 Allow Self-Signed Certificates: ${allowSelfSigned}`);
core.info("");

const axiosInstance = axios.create({
  httpsAgent: new https.Agent({
    rejectUnauthorized: !allowSelfSigned,
  }),
  timeout: 30000,
});
axiosRetry(axiosInstance, {
  retries: 3,
  retryCondition: () => true,
  onRetry: () => {
    core.info("Retrying failed API request...");
  },
});

async function run() {
  try {
    const piholeConfig = await getPiholeConfig();
    await authenticateWithPihole();
    await applyLists(piholeConfig);
    await applyLocalDnsSettings(piholeConfig);
  } catch (error) {
    core.error("Error occurred:", error.message);
    core.setFailed(`Action failed with error: ${error.message}`);
  }

  logoutFromPihole();
}

async function applyLists(piholeConfig) {
  if (!piholeConfig.blocklists || !Array.isArray(piholeConfig.blocklists)) {
    core.info(
      "⏭️ Skipping blocklist sync as no blocklists are defined in the config file."
    );
    core.info("");
    return;
  }

  const existingLists = await fetchListsFromPihole();
  await deleteExistingLists(existingLists);

  const blocklistUrls = piholeConfig.blocklists;
  await addBlocklists(blocklistUrls);

  await updateGravity();
  core.info("✅ Pi-hole blocklist sync completed successfully");
  core.info("");
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
async function addBlocklists(blocklistUrls) {
  core.info(`💾 Adding ${blocklistUrls.length} blocklists to Pi-hole`);
  for (const url of blocklistUrls) {
    core.info(`- ${url}`);
    await axiosInstance.post(`${piholeUrl}/lists`, {
      address: url,
      type: "block",
    });
  }
  core.info(`All blocklists added`);
  core.info("");
}

async function applyLocalDnsSettings(piholeConfig) {
  core.info("🔄 Updating local DNS records");
  const config = {
    dns: {
      hosts: null,
      cnames: null,
    },
  };

  const localDnsRecords = piholeConfig.localDnsRecords;
  if (localDnsRecords && Array.isArray(localDnsRecords)) {
    core.info(`Adding local DNS records`);
    config.dns.hosts = localDnsRecords.map((record) => {
      core.info(`- ${record.domain} -> ${record.ip}`);
      return `${record.ip.trim()} ${record.domain.trim()}`;
    });
  } else {
    delete config.dns.hosts;
    core.info(
      "⏭️ Skipping local DNS record sync as no localDnsRecords are defined in the config file."
    );
  }

  const localDnsCnameRecords = piholeConfig.localDnsCnames;
  if (localDnsCnameRecords && Array.isArray(localDnsCnameRecords)) {
    core.info(`Adding local DNS CNAME records`);

    config.dns.cnames = localDnsCnameRecords.map((record) => {
      core.info(`- ${record.domain} -> ${record.target}`);
      return `${record.domain.trim()},${record.target.trim()}`;
    });
  } else {
    delete config.dns.cnames;
    core.info(
      "⏭️ Skipping local DNS CNAME sync as no localDnsCnames are defined in the config file."
    );
  }

  if (
    !config.dns.hasOwnProperty("hosts") &&
    !config.dns.hasOwnProperty("cnames")
  ) {
    core.info(
      "⏭️ Skipping local DNS sync as no localDnsRecords or localDnsCnames sections are defined in the config file."
    );
    return;
  }

  await patchPiholeConfig(config);
}
async function patchPiholeConfig(config) {
  core.info(`Updating Pi-hole DNS configuration via API`);
  // Needed, since first /config request always fails
  try {
    await axiosInstance.get(`${piholeUrl}/config`);
  } catch (error) {}

  try {
    const updateResponse = await axiosInstance.patch(`${piholeUrl}/config`, {
      config: config,
    });
  } catch (error) {
    console.log(error);
    if (error.response && error.response.status === 403) {
      throw new Error(
        `❌ Could not update Pi-hole config: Please set webserver.api.app_sudo to true in Pi-hole settings (System > Settings > All Settings).`
      );
    }
    throw new Error(
      `Failed to update Pi-hole config with status: ${updateResponse.status} - ${updateResponse.statusText}`
    );
  }

  core.info(`✅ DNS configuration updated successfully`);
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
async function logoutFromPihole() {
  core.info("");
  try {
    core.info(`👋 Logging out from Pi-hole`);
    await axiosInstance.delete(`${piholeUrl}/auth`);
    core.info(`Successfully logged out from Pi-hole`);
  } catch (error) {
    core.error(`Failed to log out from Pi-hole: ${error.message}`);
  }
}

async function getPiholeConfig() {
  core.info(`📄 Reading Pi-hole config from file: ${configFile}`);
  if (!fs.existsSync(configFile)) {
    throw new Error(`Pi-hole config file not found: ${configFile}`);
  }

  const content = fs.readFileSync(configFile, "utf-8");
  core.info(`Pi-hole config file read successfully`);
  core.info(`Parsing config file`);
  const config = yaml.parse(content);
  core.info("");

  return config || {};
}

run();
