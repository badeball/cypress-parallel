import { Given } from "@cucumber/cucumber";
import path from "path";
import { insertValuesInConfigFile } from "../support/configFileUpdater";

Given("additional Cypress configuration", async function (jsonContent) {
  await insertValuesInConfigFile(
    path.join(this.tmpDir, "cypress.config.js"),
    JSON.parse(jsonContent)
  );
});
