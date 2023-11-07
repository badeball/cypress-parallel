Feature: knapsack.json
  Rule: it should handle any *normal* knapsack scenario somewhat gracefully, otherwise error
    Scenario: knapsack missing entirely
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      Given I run cypress-parallel with "--node 1:1"
      Then stderr should containing a warning "Unable to find knapsack.json, continuing without it..."
      But it passes

    Scenario: knapsack missing a file
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "knapsack.json" with:
        """
        {}
        """
      Given I run cypress-parallel with "--node 1:1"
      Then it passes

    Scenario: knapsack containing a removed file
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "knapsack.json" with:
        """
        {
          "cypress/e2e/a.js": 1,
          "cypress/e2e/b.js": 1
        }
        """
      Given I run cypress-parallel with "--node 1:1"
      Then it passes

    Scenario: knapsack containing "ignored" files (due to EG. narrow testFiles)
      Given additional Cypress configuration
        """
        {
          "e2e": {
            "specPattern": "**/a.js"
          }
        }
        """
      And a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "cypress/e2e/b.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "knapsack.json" with:
        """
        {
          "cypress/e2e/a.js": 1,
          "cypress/e2e/b.js": 1
        }
        """
      Given I run cypress-parallel with "--node 1:1"
      Then it passes
      And it should appear as if only a single test ran

    Scenario: knapsack isn't JSON
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "knapsack.json" with:
        """
        foobar
        """
      Given I run cypress-parallel with "--node 1:1"
      Then it fails
      And the output should contain
        """
        Knapsack isn't valid JSON, got 'foobar'
        """

    Scenario: knapsack isn't a valid Record<string, number>
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And a file named "knapsack.json" with:
        """
        "foobar"
        """
      Given I run cypress-parallel with "--node 1:1"
      Then it fails
      And the output should contain
        """
        Knapsack is wrongly formatted, got 'foobar'
        """

    Scenario: knapsack isn't readable
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {});
        """
      And an empty, but unreadable file named "knapsack.json"
      Given I run cypress-parallel with "--node 1:1"
      Then it fails
      And the output should contain
        """
        Unable to read knapsack: EACCES: permission denied
        """
