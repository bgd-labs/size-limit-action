import { getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
// @ts-ignore
import table from "markdown-table";
import Term from "./Term";
import SizeLimit from "./SizeLimit";

const SIZE_LIMIT_HEADING = `## size-limit report 📦 `;

async function fetchPreviousComment(
  octokit: ReturnType<typeof getOctokit>,
  repo: { owner: string; repo: string },
  pr: { number: number }
) {
  const commentList = await octokit.rest.issues.listComments({
    ...repo,
    issue_number: pr.number
  });

  const sizeLimitComment = commentList.data.find(comment =>
    comment.body.startsWith(SIZE_LIMIT_HEADING)
  );
  return !sizeLimitComment ? null : sizeLimitComment;
}

async function run() {
  try {
    const { payload, repo } = context;
    const pr = payload.pull_request;

    if (!pr) {
      throw new Error(
        "No PR found. Only pull_request workflows are supported."
      );
    }

    const token = getInput("github_token");
    const skipStep = getInput("skip_step");
    const buildScript = getInput("build_script");
    const cleanScript = getInput("clean_script");
    const script = getInput("script");
    const packageManager = getInput("package_manager");
    const directory = getInput("directory") || process.cwd();
    const minDelta = getInput("min_delta");
    const windowsVerbatimArguments =
      getInput("windows_verbatim_arguments") === "true" ? true : false;
    const octokit = getOctokit(token);
    const term = new Term();
    const limit = new SizeLimit();

    const { status, output } = await term.execSizeLimit(
      null,
      skipStep,
      buildScript,
      cleanScript,
      windowsVerbatimArguments,
      directory,
      script,
      packageManager
    );
    const { output: baseOutput } = await term.execSizeLimit(
      pr.base.ref,
      null,
      buildScript,
      cleanScript,
      windowsVerbatimArguments,
      directory,
      script,
      packageManager
    );

    let base;
    let current;

    try {
      base = limit.parseResults(baseOutput);
      current = limit.parseResults(output);
    } catch (error) {
      console.log(
        "Error parsing size-limit output. The output should be a json."
      );
      throw error;
    }

    let body = [
      SIZE_LIMIT_HEADING,
      table(
        limit.formatResults(base, current, {
          minDelta: minDelta ? Number(minDelta) : 0
        })
      )
    ].join("\r\n");

    if (body.length > 65536) body = body.substring(0, 65536);

    const sizeLimitComment = await fetchPreviousComment(octokit, repo, pr);

    if (!sizeLimitComment) {
      try {
        await octokit.rest.issues.createComment({
          ...repo,
          // eslint-disable-next-line camelcase
          issue_number: pr.number,
          body
        });
      } catch (error) {
        console.log(error);
        console.log(
          "Error creating comment. This can happen for PR's originating from a fork without write permissions."
        );
      }
    } else {
      try {
        await octokit.rest.issues.updateComment({
          ...repo,
          // eslint-disable-next-line camelcase
          comment_id: sizeLimitComment.id,
          body
        });
      } catch (error) {
        console.log(error);
        console.log(
          "Error updating comment. This can happen for PR's originating from a fork without write permissions."
        );
      }
    }

    if (status > 0) {
      setFailed("Size limit has been exceeded.");
    }
  } catch (error) {
    setFailed(error.message);
  }
}

run();
