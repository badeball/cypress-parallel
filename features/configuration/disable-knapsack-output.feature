Feature: --disable-knapsack-output
  Rule: it should disable outputting of the knapsack
    Background:
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => expect(true).to.be.true);
        """

    Scenario:
      Given I run cypress-parallel with "--node 1:1 --disable-knapsack-output"
      Then it passes
      And I should not see a file named "knapsack.json"
