// @ts-check

const CP_LABELS = ["cherry-pick", "not-cherry-pick"];
const REG_LABELS = ["regression-fix", "not-regression-fix"];

const CP_LABEL_MESSAGE = `Add only ONE of these labels to your PR: ${CP_LABELS.join(
  ","
)}`;
const REG_LABEL_MESSAGE = `Add only ONE of these labels to your PR: ${REG_LABELS.join(
  ","
)}`;

/**
 * @type {any}
 * @param {import('github-script').AsyncFunctionArguments} AsyncFunctionArguments
 * */
module.exports = async ({ github, context, core }) => {
  const { pull_request: pr } = context.payload;

  if (!pr) {
    console.error("This script was not run on a PR, cannot proceed.");
    process.exit(1);
  }

  const prContext = {
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: context.issue.number,
  };

  /**
   * @type string[]
   */
  const labels = pr.labels.map((label) => label.name);
  const cpCount = CP_LABELS.filter((label) => labels.includes(label)).length;
  const regCount = REG_LABELS.filter((label) => labels.includes(label)).length;

  const automaticRemediations = [];
  const remediations = [];
  if (cpCount !== 1) {
    remediations.push(CP_LABEL_MESSAGE);
  } else if (labels.includes("cherry-pick")) {
    const cherryPickMatch = context.payload.pull_request?.body?.match(
      /^This is a fix for an issue found on: (?<env>.*), via: (?<source>.*)/m
    );
    const hasEnv = ["admin", "staging", "production"].includes(
      cherryPickMatch?.groups?.env ?? ""
    );
    const hasSource = [
      "user report",
      "automated test",
      "observability",
    ].includes(cherryPickMatch?.groups?.source ?? "");

    if (!cherryPickMatch || !hasEnv || !hasSource) {
      remediations.push(
        `Since your PR is a cherry-pick, please add the following line to your PR and choose the appropriate environment and source: <pre>This is a fix for an issue found on: [admin/staging/production], via: [user report/automated test/observability]</pre>`
      );
    }
  }

  if (regCount !== 1) {
    remediations.push(REG_LABEL_MESSAGE);
  } else if (labels.includes("regression-fix")) {
    const regressionFixMatch = context.payload.pull_request?.body?.match(
      /^This fixes a regression introduced by (?<prLink>https:\/\/github.com\/tryretool\/.*\/pull\/[0-9]+)$/m
    );

    const prLink = regressionFixMatch?.groups?.prLink;

    if (!regressionFixMatch || !prLink) {
      remediations.push(
        `Since your PR is a regression-fix, please add the following line to your PR: <pre>This fixes a regression introduced by [insert link to PR here]</p>`
      );
    }
  }

  // find any existing "REMEDIATIONS" comment if any, and delete it
  const allComments = await github.rest.issues.listComments(prContext);
  const deletions = allComments.data
    .filter(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.startsWith("#### Remediations needed")
    )
    .map((comment) => {
      github.rest.issues.deleteComment({
        ...prContext,
        comment_id: comment.id,
      });
    });

  await Promise.all(deletions);

  if (remediations.length !== 0) {
    await github.rest.issues.createComment({
      ...prContext,
      body: `#### Remediations needed
${remediations.map((item) => `* ${item}`).join("\n")}`,
    });
    process.exit(1);
  }
};
