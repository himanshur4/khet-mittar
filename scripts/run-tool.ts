/**
 * Debug CLI: call one agent tool directly with JSON args, exactly as the orchestrator would.
 *   npm run tool -- getWeatherForecast '{"latitude":19.99,"longitude":73.79,"days":3}'
 *   npm run tool -- list
 */
import { getContainer } from "../src/core/container";
import { describeError } from "../src/core/lib/errors";

const [name, rawArgs = "{}"] = process.argv.slice(2);
const { tools } = getContainer();

if (!name || name === "list") {
  for (const t of tools.list()) console.log(`${t.name}\n  ${t.description}\n`);
  process.exit(0);
}

const tool = tools.get(name);
if (!tool) {
  console.error(`Unknown tool "${name}". Run with "list" to see tools.`);
  process.exit(1);
}

const validation = tool.validate(JSON.parse(rawArgs));
if (!validation.ok) {
  console.error(
    "Invalid args (this is what the LLM would be told):\n  " + validation.issues.join("\n  "),
  );
  process.exit(1);
}

const started = Date.now();
try {
  const output = await validation.run({ farmer: null });
  console.log(JSON.stringify(output, null, 2));
  console.error(`\n${name} finished in ${Date.now() - started} ms`);
} catch (error) {
  console.error(`${name} failed after ${Date.now() - started} ms: ${describeError(error)}`);
  process.exitCode = 1;
}
process.exit();
