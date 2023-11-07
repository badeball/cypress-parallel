Feature: distribute (unweighed strategy)
  Rule: it should distribute unweighed files evenly, despite content length
    Background:
      Given a file named "cypress/e2e/a.js" with:
        """
        it("should pass", () => {
          expect(true).to.be.true
        });
        """
      And a file named "cypress/e2e/b.js" with:
        """
        it("should pass", () => {
          expect(true).to.be.true
        });
        it("should pass", () => {
          expect(true).to.be.true
        });
        """
      And a file named "cypress/e2e/c.js" with:
        """
        it("should pass", () => expect(true).to.be.true);
        """
      And a file named "cypress/e2e/d.js" with:
        """
        it("should pass", () => expect(true).to.be.true);
        """
      And a file named "knapsack.json" with:
        """
        {
          "cypress/e2e/a.js": 30,
          "cypress/e2e/b.js": 60
        }
        """

    Scenario: 1 / 2 node
      Given I run cypress-parallel with "--node 1:2 --unweighed-strategy distribute"
      Then it passes
      And it should appear to have run the specs
        | Name |
        | a.js |
        | c.js |

    Scenario: 2 / 2 node
      Given I run cypress-parallel with "--node 2:2  --unweighed-strategy distribute"
      Then it passes
      And it should appear to have run the specs
        | Name |
        | b.js |
        | d.js |
