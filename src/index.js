const core = require("@actions/core");
const axios = require("axios");

async function run() {
  try {
    core.info("Starting Pi-hole blocklist sync...");

    const piholeUrl = core.getInput("pihole-url", { required: true });
    const piholePassword = core.getInput("pihole-app-password", {
      required: true,
    });
    const blocklistFile = core.getInput("blocklist-file", { required: true });

    core.info(`Pi-hole URL: ${piholeUrl}`);
    core.info(`Blocklist File: ${blocklistFile}`);

    core.info(`Authenticating with Pi-hole...`);

    const authResponse = await axios.post(`${piholeUrl}/auth`, {
      password: piholePassword,
    });
    if (authResponse.status !== 200) {
      throw new Error(
        `Authentication failed with status: ${authResponse.status} - ${authResponse.statusText}`
      );
    }

    const { sid } = authResponse.data;
    core.info(`Authentication successful`);
    core.info("");

    core.info(`Fetching blocklists via API`);

    const blocklistResponse = await axios.get(`${piholeUrl}/admin/lists`, {
      headers: {
        sid: sid,
      },
    });

    if (blocklistResponse.status !== 200) {
      throw new Error(
        `Failed to fetch blocklists with status: ${blocklistResponse.status} - ${blocklistResponse.statusText}`
      );
    }

    const { lists } = await blocklistResponse.json();
    core.info(`Fetched ${lists.length} blocklists from Pi-hole`);

    lists.forEach((list) => {
      core.info(`- ${list.address}`);
    });

    core.info("");
    
  } catch (error) {
    // Log the error and fail the action
    core.error("Error occurred:", error.message);
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

run();
