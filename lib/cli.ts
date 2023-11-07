import { promises as fs, constants as fsConstants } from "fs";

import path from "path";

import util from "util";

import child_process from "child_process";

import {
  getConfiguration as getCypressConfiguration,
  getTestFiles,
} from "@badeball/cypress-configuration";

import { Command, InvalidArgumentError } from "commander";

import { isNpm, isYarn } from "is-npm";

import { parse } from "shell-quote";

import { tryResolveNodeConfiguration } from "./ci";

import {
  IParallelConfiguration,
  NodeConfigurationParseError,
  parseAndValidateNodeConfiguration,
} from "./configuration";

import debug from "./debug";

import { CypressParallelError } from "./error";

import { distribute } from "./unweighed-strategies/distribute";

import { estimate } from "./unweighed-strategies/estimate";

import {
  resolveCustomStrategy,
  UnweighedFile,
  WeighedFile,
} from "./unweighed-strategy";

import { isKnapsack, isString } from "./type-guards";

import { compare } from "./unweighed-strategies/utils";

import { name, version } from "../package.json";

function determineCypressRunCommand() {
  if (isNpm) {
    return "npx cypress run";
  } else if (isYarn) {
    return "yarn cypress run";
  } else {
    throw new CypressParallelError(
      "Unable to determine how to run Cypress, please specify a cypress run command"
    );
  }
}

function parseNodeConfiguration(value: string) {
  const values = value.split(":");

  if (values.length !== 2) {
    throw new InvalidArgumentError(
      "Expected --node configuration matching <index>:<total>"
    );
  }

  const [index, count] = values;

  try {
    return parseAndValidateNodeConfiguration(index, count);
  } catch (e) {
    if (e instanceof NodeConfigurationParseError) {
      throw new InvalidArgumentError(e.message);
    } else {
      throw e;
    }
  }
}

function parseUnweighedStrategy(value: string) {
  if (value !== "estimate" && value !== "distribute") {
    throw new InvalidArgumentError(
      "Valid unweighed strategies are 'estimate' and 'distribute'"
    );
  }

  return value;
}

async function readKnapsack(filepath: string) {
  const aboluteFilepath = path.isAbsolute(filepath)
    ? filepath
    : path.join(process.cwd(), filepath);

  let knapsackContent;

  try {
    knapsackContent = (await fs.readFile(aboluteFilepath)).toString();
  } catch (e: any) {
    if (e?.code === "ENOENT") {
      const knapsackName = path.basename(aboluteFilepath);

      console.warn(`Unable to find ${knapsackName}, continuing without it...`);
      return {};
    } else {
      throw new CypressParallelError(`Unable to read knapsack: ${e.message}`);
    }
  }

  let maybeKnapsack;

  try {
    maybeKnapsack = JSON.parse(knapsackContent);
  } catch {
    throw new CypressParallelError(
      `Knapsack isn't valid JSON, got ${util.inspect(knapsackContent)}`
    );
  }

  if (isKnapsack(maybeKnapsack)) {
    return maybeKnapsack;
  } else {
    throw new CypressParallelError(
      `Knapsack is wrongly formatted, got ${util.inspect(maybeKnapsack)}`
    );
  }
}

const program = new Command();

program.version(`${name}-v${version}`, "-v, --version");

program.allowUnknownOption();

program.option(
  "--cypress-run-command <cmd>",
  "specifies the command to run cypress (in non-interactive mode), defaults to 'npx cypress run' or 'yarn cypress run' depending on how invoked"
);

program.option(
  "--node <index>:<count>",
  "specifies number of buckets and which to run",
  parseNodeConfiguration
);

program.option(
  "--knapsack <path>",
  "specifies the path to the knapsack file",
  "knapsack.json"
);

program.option(
  "--read-knapsack <path>",
  "specifies the path to the knapsack file to read"
);

program.option(
  "--write-knapsack <path>",
  "specifies the path to the knapsack file to write"
);

program.option("--disable-knapsack-output", "disables knapsack output", false);

program.option(
  "--unweighed-strategy <strategy>",
  "strategy to utilize for unweighed test files ('estimate' (default) | 'distribute')",
  parseUnweighedStrategy,
  "estimate"
);

type PartialBy<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export async function run(argv: string[], env: NodeJS.ProcessEnv, cwd: string) {
  try {
    program.parse(argv);

    const cypressArgs = program.parseOptions(argv).unknown;

    if (cypressArgs.includes("-s") || cypressArgs.includes("--spec")) {
      throw new CypressParallelError(
        "Unable to parallelize tests that are already scoped"
      );
    }

    const options = program.opts() as PartialBy<
      IParallelConfiguration,
      "node" | "cypressRunCommand"
    >;

    const node = options.node || tryResolveNodeConfiguration(env);

    if (!node) {
      throw new CypressParallelError(
        "Unable to determine node index and node count, please specify --node <index>:<count>"
      );
    }

    let parallelConfiguration: IParallelConfiguration = {
      cypressRunCommand:
        options.cypressRunCommand || determineCypressRunCommand(),
      node,
      unweighedStrategy:
        (await resolveCustomStrategy()) || options.unweighedStrategy,
      knapsack: options.knapsack,
      readKnapsack: options.readKnapsack,
      writeKnapsack: options.writeKnapsack,
      disableKnapsackOutput: options.disableKnapsackOutput,
    };

    const cypressConfiguration = getCypressConfiguration({
      testingType: "e2e",
      argv,
      env,
      cwd,
    });

    const reporterOptions = ["-r", "--reporter", "-o", "--reporter-options"];

    for (const reporterOption of reporterOptions) {
      if (cypressArgs.includes(reporterOption)) {
        parallelConfiguration = {
          ...parallelConfiguration,
          disableKnapsackOutput: true,
        };
        break;
      }
    }

    let unweighedStrategy;

    if (parallelConfiguration.unweighedStrategy === "estimate") {
      unweighedStrategy = estimate;
    } else if (parallelConfiguration.unweighedStrategy === "distribute") {
      unweighedStrategy = distribute;
    } else {
      unweighedStrategy = parallelConfiguration.unweighedStrategy;
    }

    const knapsack = await readKnapsack(
      parallelConfiguration.readKnapsack ?? parallelConfiguration.knapsack
    );

    const testFiles = getTestFiles(cypressConfiguration);

    const weighedFiles: WeighedFile[] = await Object.entries(knapsack).reduce<
      Promise<WeighedFile[]>
    >(async (weighedFilesPromise, entry) => {
      const weighedFiles = await weighedFilesPromise;

      const file = path.join(cypressConfiguration.projectRoot, entry[0]);

      if (!testFiles.includes(file)) {
        return weighedFiles;
      }

      try {
        await fs.access(file, fsConstants.F_OK);
      } catch {
        return weighedFiles;
      }

      return [
        ...weighedFiles,
        {
          file,
          content: (await fs.readFile(file)).toString(),
          weight: entry[1],
        },
      ];
    }, Promise.resolve([]));

    const unweighedFiles: UnweighedFile[] = await testFiles
      .map((testFile) =>
        path.relative(cypressConfiguration.projectRoot, testFile)
      )
      .filter((testFile) => !Object.keys(knapsack).includes(testFile))
      .reduce<Promise<UnweighedFile[]>>(async (testFilesPromise, testFile) => {
        const testFiles = await testFilesPromise;

        const file = path.join(cypressConfiguration.projectRoot, testFile);

        return [
          ...testFiles,
          {
            file,
            content: (await fs.readFile(file)).toString(),
          },
        ];
      }, Promise.resolve([]));

    const schedule = unweighedStrategy(
      weighedFiles,
      unweighedFiles,
      parallelConfiguration.node.count
    );

    debug(
      `Schedule determined ${util.inspect(
        schedule.map((group) => group.map((file) => file.file))
      )}`
    );

    /**
     * Validate the generated schedule.
     */
    const outputFiles = schedule
      .flatMap((node) => node.map((file) => file.file))
      .sort(compare);

    for (const testFile of testFiles) {
      if (!outputFiles.includes(testFile)) {
        const relativePath = path.relative(
          cypressConfiguration.projectRoot,
          testFile
        );

        throw new CypressParallelError(
          `Test file ${relativePath} wasn't distributed by the configured strategy`
        );
      }
    }

    for (const outputFile of outputFiles) {
      if (!testFiles.includes(outputFile)) {
        const relativePath = path.relative(
          cypressConfiguration.projectRoot,
          outputFile
        );

        throw new CypressParallelError(
          `The configured strategy produced ${relativePath}, which wasn't part of the input`
        );
      }
    }

    const testFilesForNode = schedule[parallelConfiguration.node.index - 1].map(
      (testFile) =>
        path.relative(cypressConfiguration.projectRoot, testFile.file)
    );

    const parsedRunCmd = parse(parallelConfiguration.cypressRunCommand);

    if (!parsedRunCmd.every(isString)) {
      throw new Error(
        `Expected a run command without shell operators (such as '&&'), but go ${util.inspect(
          parallelConfiguration.cypressRunCommand
        )}`
      );
    }

    const reporterArgs = parallelConfiguration.disableKnapsackOutput
      ? []
      : [
          "--reporter",
          "cypress-multi-reporters",
          "--reporter-options",
          JSON.stringify({
            reporterEnabled:
              "spec, @badeball/cypress-parallel/knapsack-reporter",
            badeballCypressParallelKnapsackReporterReporterOptions: {
              output:
                parallelConfiguration.writeKnapsack ??
                parallelConfiguration.knapsack,
            },
          }),
        ];

    const [cmd, ...args] = parsedRunCmd;

    const fullArgs = [
      ...args,
      ...cypressArgs,
      ...reporterArgs,
      "--spec",
      testFilesForNode.join(","),
    ];

    debug(`Running ${util.inspect(cmd)} with ${util.inspect(fullArgs)}`);

    const proc = child_process.spawn(cmd, fullArgs, {
      stdio: "inherit",
    });

    proc.on("exit", function (code, signal) {
      process.on("exit", function () {
        if (signal) {
          process.kill(process.pid, signal);
        } else if (code) {
          process.exitCode = code;
        }
      });
    });

    process.on("SIGINT", () => proc.kill("SIGINT"));
    process.on("SIGTERM", () => proc.kill("SIGTERM"));
  } catch (e) {
    if (e instanceof CypressParallelError) {
      console.error(e.message);
    } else if (e instanceof Error) {
      console.error(e.stack);
    } else {
      console.error(util.inspect(e));
    }

    process.exitCode = 1;
  }
}
