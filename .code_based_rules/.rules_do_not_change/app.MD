### Rules and Issues We Need to Fix

 1. all coordinates must be 6 decimal precise coordinates
 1. -a exception location received from offer_analyzer shortcut
 2. never hardcode models or locations even as an example
 3. this is a global app
 4. documentation should match code
 5. feature specifications should be created with AI/Business Analytics Best Practices
 6. system specifications should be created with AI/Business Analytics Best Practices
 7. UI/UX specifications should be created with AI/Business Analytics Best Practices
 8. AI/Business Analytics Best Practices must be established (total tokens per document AI can read, turns it can take, scope creep, tech debt, token limits, coding limits - list not exclusive)


## Issues with features and Workflow

1. Google, Apple and other third party sign-in/sign-up is not complete
2. Rate limits were not agreed upon and need to be
3. We do not need to send future school closures to the strategist
4. Strategy table should contain identifiers and immediate strategy and drops when snapshot drops
5. Permissions example "  permissions        ┐
                     │ {
                     │   "geolocation": "granted"
                     │ }" Do not need to be in the snapshot. A snapshot id should not be generated without end user allowing location - workflow identifiers should be held in a workflow table
6. Snapshot row is cleared upon manual reset so permission should be assumed granted and workflow identifier updated with last generated time in a workflow table
7. tomtom incidents no longer showing on map
8. review queue was removed and replaced by a change log that doesn't work - concerned with work not be logged for monitoring not just simple instructions but handling complex systems 
9. If cli or any model gets too smart but has no memory it is made to validate code that it wrote and must use grep, agents, and code sweep searches to sift through its own work to find errors. This can cause it to recode, not follow naming standards, case, update documents but states when is suited - like skipping over found errors as scope creep from rules in its md. This can make larger errors and it remembers none. The worst part is that it assumes it was or is a user error.
10. We need to find a way that helps the model to remember to use best practices, follow an app build similar to a large engineering and UI team structure but to figure out that they need to understand not just read a few sentences of each file and guess. Models must intercept a repo and fix it within a very few turns and they come across as stressed when they are unable to hold full context.

