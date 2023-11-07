import { After, Before, formatterHelpers } from "@cucumber/cucumber";
import path from "path";
import assert from "assert";
import { promises as fs, constants } from "fs";
import { writeFile } from "./helpers";

const projectPath = path.join(__dirname, "..", "..");

Before(async function ({ gherkinDocument, pickle }) {
  assert(gherkinDocument.uri, "Expected gherkinDocument.uri to be present");

  const relativeUri = path.relative(process.cwd(), gherkinDocument.uri);

  const { line } = formatterHelpers.PickleParser.getPickleLocation({
    gherkinDocument,
    pickle,
  });

  this.tmpDir = path.join(projectPath, "tmp", `${relativeUri}_${line}`);

  await fs.rm(this.tmpDir, { recursive: true, force: true });

  await writeFile(
    path.join(this.tmpDir, "cypress.config.js"),
    `
      const { defineConfig } = require("cypress");

      module.exports = defineConfig({
        e2e: {
          video: false,
          supportFile: false,
          specPattern: "cypress/e2e/**/*.js",
        }
      })
    `
  );

  await fs.mkdir(path.join(this.tmpDir, "node_modules", "@badeball"), {
    recursive: true,
  });

  await fs.symlink(
    path.join(projectPath, "node_modules", "cypress-multi-reporters"),
    path.join(this.tmpDir, "node_modules", "cypress-multi-reporters")
  );

  const selfLink = path.join(
    projectPath,
    "node_modules",
    "@badeball",
    "cypress-parallel"
  );

  try {
    await fs.access(selfLink, constants.F_OK);
    await fs.unlink(selfLink);
  } catch {}

  await fs.symlink(projectPath, selfLink, "dir");
});

After(function () {
  if (
    this.lastRun != null &&
    this.lastRun.exitCode !== 0 &&
    !this.verifiedLastRunError
  ) {
    throw new Error(
      `Last run errored unexpectedly. Output:\n\n${this.lastRun.output}`
    );
  }
});
