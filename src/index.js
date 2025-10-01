const core = require("@actions/core");
const github = require("@actions/github");

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
  } catch (error) {
    // Log the error and fail the action
    core.error("Error occurred:", error.message);
    core.setFailed(`Action failed with error: ${error.message}`);
  }
}

run();
