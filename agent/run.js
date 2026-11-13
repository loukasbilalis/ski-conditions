// agent/run.js
// A small demo AI agent that answers questions about ski conditions by calling
// the tools in src/tools.js.
//
// Run it from the project folder (not from inside agent/):
//   npm install                                  (first time only)
//   ant auth login                               (or: export ANTHROPIC_API_KEY="your-key")
//   node agent/run.js "Which resort has the best conditions tomorrow morning?"
//
// How it works (the "agent loop"):
//   1. We send Claude your question plus the list of tools it may use.
//   2. Claude replies either with an answer, or with "please run this tool".
//   3. We run the tool (that is our own code in src/tools.js) and send back the result.
//   4. Claude reads it and goes to step 2, until it has an answer.
// The SDK's "tool runner" does steps 2-4 for us.

import Anthropic from "@anthropic-ai/sdk";
import { betaTool } from "@anthropic-ai/sdk/helpers/beta/json-schema";
import { tools } from "../src/tools.js";
import { buildSystemPrompt } from "./prompt.js"; // the instructions that set up the agent's behaviour

// Which Claude model to use. Haiku is small, fast and cheap, which is plenty for
// looking things up with tools and summarising the results. If its answers are not
// good enough, try "claude-sonnet-5-5" or "claude-opus-5-5" here.
const MODEL = "claude-haiku-5-5";

const question =
  process.argv.slice(2).join(" ") || "Which resort has the best conditions tomorrow, and when is the best time to ski there?";

// The SDK needs each tool as a "runnable tool". Our tools already have a name,
// description and input schema; we only have to turn the result into text.
const runnableTools = tools.map((tool) =>
  betaTool({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.input_schema,
    // The tool's answer must be text, so we turn the data into JSON text.
    // If run() throws an error, the SDK sends it to Claude as an error result.
    run: async (input) => JSON.stringify(await tool.run(input)),
  })
);

// Reads your API key from the ANTHROPIC_API_KEY environment variable.
const client = new Anthropic();

try {
  console.log(`Question: ${question}\n`);

  const runner = client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    // How hard Claude thinks. "medium" is plenty for looking up data and summarising it.
    output_config: { effort: "medium" },
    system: buildSystemPrompt(), // built fresh each run, so it contains today's date
    tools: runnableTools,
    messages: [{ role: "user", content: question }],
    max_iterations: 10, // a safety stop, so a confused agent can't loop forever
  });

  // Each loop round is one reply from Claude. We print the tool calls so you can watch it work.
  let finalMessage;
  for await (const message of runner) {
    for (const block of message.content) {
      if (block.type === "tool_use") console.log(`  -> calling ${block.name}(${JSON.stringify(block.input)})`);
    }
    finalMessage = message;
  }

  // Always check why Claude stopped before using the answer.
  if (finalMessage.stop_reason === "refusal") {
    console.log("\nClaude declined to answer this request.");
  } else if (finalMessage.stop_reason === "max_tokens") {
    console.log("\n(The answer was cut off because it hit the length limit.)");
  }

  console.log("\nAnswer:\n");
  for (const block of finalMessage.content) {
    if (block.type === "text") console.log(block.text);
  }
} catch (error) {
  // Typed errors from the SDK, most specific first.
  if (error instanceof Anthropic.AuthenticationError) {
    console.error("Authentication failed. Check that ANTHROPIC_API_KEY is set to a valid key.");
  } else if (error instanceof Anthropic.RateLimitError) {
    console.error("Rate limited. Wait a minute and try again.");
  } else if (error instanceof Anthropic.APIError) {
    console.error(`The API returned an error (${error.status}): ${error.message}`);
  } else if (/api key|authentication/i.test(error.message)) {
    console.error("No API key found. Set it with:  export ANTHROPIC_API_KEY=\"your-key\"");
  } else {
    throw error;
  }
  process.exitCode = 1;
}
