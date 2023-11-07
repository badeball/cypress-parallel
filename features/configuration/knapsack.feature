Feature: --knapsack
  Rule: it should store knapsack at provided location (default 'knapsack.json')
    Background:
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => expect(true).to.be.true);
        """

    Scenario: no value provided
      Given a file named "knapsack.json" with:
        """
        {}
        """
      And I run cypress-parallel with "--node 1:1"
      Then it passes
      And I should see a file "knapsack.json" with content matching:
        """
        {
          "cypress/e2e/a.js": \d+
        }
        """

    Scenario: custom location provided
      Given a file named "sackknap.json" with:
        """
        {}
        """
      And I run cypress-parallel with "--knapsack sackknap.json --node 1:1"
      Then it passes
      And I should see a file "sackknap.json" with content matching:
        """
        {
          "cypress/e2e/a.js": \d+
        }
        """

    Scenario: custom read & write location provided
      Given a file named "knapsack.json" with:
        """
        {}
        """
      And I run cypress-parallel with "--read-knapsack knapsack.json --write-knapsack sackknap.json --node 1:1"
      Then it passes
      And I should see a file "sackknap.json" with content matching:
        """
        {
          "cypress/e2e/a.js": \d+
        }
        """
