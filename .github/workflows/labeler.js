// @ts-check

/**
 *
 * @param {string[]} labels
 * @param {string} searchTerm
 * @returns {string}
 */
const check = (labels, searchTerm) => {
  return labels.includes(searchTerm) ? "x" : " ";
};

/**
 * @param {string[]} labels
 * @returns string
 */
const CP_LABEL_CHECKLIST = (labels) => `### Regression Fix (required)
- [${check(labels, "regression-fix")}] This fixes a regression
- [${check(labels, "not-regression-fix")}] This is not a regression fix`;

/**
 * @param {string[]} labels
 * @returns string
 */
const REG_LABEL_CHECKLIST = (
  labels
) => `### Cherry-pick (only required for cp PRs)
- [${check(labels, "cherry-pick")}] This is a cherry pick`;

/**
 * @param {string[]} labels
 * @returns string
 */
const MIGRATIONS_CHECKLIST = (labels) => `### Migrations (required)
- [${check(
  labels,
  "migration-onprem-long-running"
)}] Long running migration expected for On-prem
- [${check(
  labels,
  "migration-cloud-long-running"
)}] Long running migration expected for Cloud
- [${check(labels, "fast-migration")}] Migration will complete quickly
- [${check(labels, "no-migration")}] No Migration Involved`;

/**
 * @type {Promise<void>}
 * @param {import('github-script').AsyncFunctionArguments} AsyncFunctionArguments
 * */
module.exports = async ({ github, context, core }) => {
  // prevent infinite loops - don't run this if the actor is the github-action
  // that's editing comments / adding / removing labels
  console.log(`Actor is ${context.actor}`);
  if (context.actor === "github-actions[bot]") {
    console.log(`Skipping labeler flow`);
    return;
  }

  const { pull_request: pr } = context.payload;
  const prContext = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  };

  /**
   * Automatically calls the API to set (or unset) labels for a PR
   * based on the {[string]: boolean } map that is passed in
   *
   * @param {{ [label in string]: boolean }} labels
   */
  const setLabels = async (labels) => {
    /** @type {Promise[]} */
    const promises = [];

    /** @type {string[]}*/
    const labelsToAdd = [];

    for (const label of Object.keys(labels)) {
      if (labels[label]) {
        labelsToAdd.push(label);
      } else {
        console.log(`Removing ${label}`);
        promises.push(
          github.rest.issues.removeLabel({ ...prContext, name: label })
        );
      }
    }

    console.log(`Adding ${labelsToAdd.join(",")}`);
    promises.push(
      github.rest.issues.addLabels({ ...prContext, labels: labelsToAdd })
    );

    await Promise.all(promises);
  };

  if (!pr) {
    console.error("This script was not run on a PR, cannot proceed.");
    process.exit(1);
  }

  /**
   * @type string[]
   */
  const currentLabels = pr.labels.map((label) => label.name);
  const checklistBody = [
    CP_LABEL_CHECKLIST,
    REG_LABEL_CHECKLIST,
    MIGRATIONS_CHECKLIST,
  ]
    .map((fn) => fn(currentLabels))
    .join("\n\n");

  const allComments = await github.rest.issues.listComments(prContext);
  const checklistComments = allComments.data.filter(
    (comment) =>
      comment.user?.login === "github-actions[bot]" &&
      comment.body?.startsWith("## PR Checklist")
  );

  if (checklistComments.length === 1) {
    // perform a sync between the checklist and the current labels, depending on the type of event
    if (
      context.eventName === "issue_comment" &&
      context.payload.action === "edited"
    ) {
      console.log("Going to auto-set labels");
      const body = checklistComments[0].body ?? "";

      const newLabels = {
        "regression-fix": false,
        "not-regression-fix": false,

        "cherry-pick": false,

        "migration-onprem-long-running": false,
        "migration-cloud-long-running": false,
        "fast-migration": false,
        "no-migration": false,
      };

      // regression fix check
      if (body.match(/- \[[xX]\] This fixes a regression/)) {
        newLabels["regression-fix"] = true;
      } else {
        newLabels["no-regression-fix"] = true;
      }

      // cherry-pick check
      if (body.match(/- \[[xX]\] This is a cherry pick/)) {
        newLabels["cherry-pick"] = true;
      }

      // migrations check
      if (
        body.match(/- \[[xX]\] Long running migration expected for On-prem/)
      ) {
        newLabels["migration-onprem-long-running"] = true;
      } else if (
        body.match(/- \[[xX]\] Long running migration expected for Cloud/)
      ) {
        newLabels["migration-cloud-long-running"] = true;
      } else if (body.match(/- \[[xX]\] Migration will complete quickly/)) {
        newLabels["fast-migration"] = true;
      } else {
        newLabels["no-migration"] = true;
      }

      await setLabels(newLabels);
      console.log("Finished setting labels");
    } else {
      // update the checklist instead for the current comment
      await github.rest.issues.updateComment({
        ...prContext,
        comment_id: checklistComments[0].id,
        body: `## PR Checklist\n\n${checklistBody}`,
      });
      console.log("Finished updating checklist");
    }
  } else {
    // delete all existing checklist comments (edge case) then create a new checklist comment (for new PRs)
    const deletions = checklistComments.map((comment) =>
      github.rest.issues.deleteComment({ ...prContext, comment_id: comment.id })
    );
    await Promise.all(deletions);
    await github.rest.issues.createComment({
      ...prContext,
      body: `## PR Checklist\n\n${checklistBody}`,
    });
  }
};
