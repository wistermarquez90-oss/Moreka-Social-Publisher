import "dotenv/config";
import { runContentWorker } from "../api/services/content-worker";

const force = process.argv.includes("--force");
runContentWorker({ force })
  .then((result) => {
    console.log(JSON.stringify(result));
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
